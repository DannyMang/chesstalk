import {
  Color,
  GameResult,
  ILLEGAL_MOVE_LIMIT,
  type Mode,
  Termination,
  type TimeControl,
} from "@chesstalk/shared/enums";
import type { GamePlayerSnapshot, MoveRecord } from "@chesstalk/shared/types";
import type { ServerGameMessage } from "@chesstalk/shared/wire";
import { Chess, type Move as ChessJsMove } from "chess.js";
import type { WebSocket } from "ws";
import { logger } from "../logger.ts";
import { remainingMs } from "./clock.ts";

export interface GameEndInfo {
  result: GameResult;
  termination: Termination;
}

export type EndListener = (game: GameActor) => void | Promise<void>;
export type MoveListener = (game: GameActor, move: MoveRecord) => void | Promise<void>;

export type MoveProposeResult =
  | { ok: true; move: MoveRecord; ended: GameEndInfo | null }
  | { ok: false; reason: string; illegalCount: number; illegalLimit: number; ended: GameEndInfo | null };

export interface IllegalParseAttemptResult {
  illegalCount: number;
  illegalLimit: number;
  terminal: GameEndInfo | null;
}

function chessTurnToColor(turn: "w" | "b"): Color {
  return turn === "w" ? Color.White : Color.Black;
}

function otherColor(c: Color): Color {
  return c === Color.White ? Color.Black : Color.White;
}

function winnerFromColor(c: Color): GameResult {
  return c === Color.White ? GameResult.White : GameResult.Black;
}

export class GameActor {
  readonly id: string;
  readonly mode: Mode;
  readonly timeControl: TimeControl;
  readonly white: GamePlayerSnapshot;
  readonly black: GamePlayerSnapshot;
  readonly chess: Chess;
  readonly startedAt: Date;
  readonly moves: MoveRecord[] = [];
  readonly illegalCount: { white: number; black: number } = { white: 0, black: 0 };
  readonly connections: Map<Color, WebSocket> = new Map();

  whiteClockMs: number;
  blackClockMs: number;
  // Server-monotonic timestamp anchor for the side currently on the move.
  // Set when the game starts and re-anchored after every accepted move.
  lastMoveAt: number;

  status: "active" | "ended" = "active";
  result: GameResult | null = null;
  termination: Termination | null = null;
  endedAt: Date | null = null;

  drawOfferBy: Color | null = null;

  private readonly endListeners: EndListener[] = [];
  private readonly moveListeners: MoveListener[] = [];

  constructor(params: {
    id: string;
    mode: Mode;
    timeControl: TimeControl;
    white: GamePlayerSnapshot;
    black: GamePlayerSnapshot;
    now: number;
  }) {
    this.id = params.id;
    this.mode = params.mode;
    this.timeControl = params.timeControl;
    this.white = params.white;
    this.black = params.black;
    this.chess = new Chess();
    this.startedAt = new Date(params.now);
    this.whiteClockMs = params.timeControl.initialSeconds * 1000;
    this.blackClockMs = params.timeControl.initialSeconds * 1000;
    this.lastMoveAt = params.now;
  }

  onEnd(listener: EndListener): void {
    this.endListeners.push(listener);
  }

  onMove(listener: MoveListener): void {
    this.moveListeners.push(listener);
  }

  userColor(userId: string): Color | null {
    if (this.white.userId === userId) return Color.White;
    if (this.black.userId === userId) return Color.Black;
    return null;
  }

  turn(): Color {
    return chessTurnToColor(this.chess.turn());
  }

  // Returns live clock values reflecting the elapsed time of the side
  // currently on the move. Use this for any outbound state snapshot.
  clockSnapshot(now: number): { whiteClockMs: number; blackClockMs: number } {
    if (this.status === "ended") {
      return { whiteClockMs: this.whiteClockMs, blackClockMs: this.blackClockMs };
    }
    const turn = this.turn();
    if (turn === Color.White) {
      return {
        whiteClockMs: remainingMs(this.whiteClockMs, this.lastMoveAt, now),
        blackClockMs: this.blackClockMs,
      };
    }
    return {
      whiteClockMs: this.whiteClockMs,
      blackClockMs: remainingMs(this.blackClockMs, this.lastMoveAt, now),
    };
  }

  attachConnection(color: Color, ws: WebSocket): void {
    this.connections.set(color, ws);
  }

  detachConnection(color: Color, ws: WebSocket): void {
    const existing = this.connections.get(color);
    if (existing === ws) {
      this.connections.delete(color);
    }
  }

  broadcast(msg: ServerGameMessage): void {
    const payload = JSON.stringify(msg);
    for (const ws of this.connections.values()) {
      if (ws.readyState === ws.OPEN) {
        try {
          ws.send(payload);
        } catch (err) {
          logger.warn("broadcast send failed", { gameId: this.id, err: String(err) });
        }
      }
    }
  }

  sendTo(color: Color, msg: ServerGameMessage): void {
    const ws = this.connections.get(color);
    if (!ws || ws.readyState !== ws.OPEN) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch (err) {
      logger.warn("sendTo failed", { gameId: this.id, color, err: String(err) });
    }
  }

  proposeMove(byUserId: string, raw: string, now: number = Date.now()): MoveProposeResult {
    if (this.status !== "active") {
      return {
        ok: false,
        reason: "Game is not active",
        illegalCount: 0,
        illegalLimit: ILLEGAL_MOVE_LIMIT,
        ended: null,
      };
    }

    const color = this.userColor(byUserId);
    if (color === null) {
      return {
        ok: false,
        reason: "Not a player in this game",
        illegalCount: 0,
        illegalLimit: ILLEGAL_MOVE_LIMIT,
        ended: null,
      };
    }

    if (color !== this.turn()) {
      return {
        ok: false,
        reason: "Not your turn",
        illegalCount: this.illegalCountFor(color),
        illegalLimit: ILLEGAL_MOVE_LIMIT,
        ended: null,
      };
    }

    // Deduct elapsed time before applying the move so a player on the brink
    // can still flag mid-think.
    const elapsed = now - this.lastMoveAt;
    const clockBefore = color === Color.White ? this.whiteClockMs : this.blackClockMs;
    const remainingBefore = clockBefore - elapsed;
    if (remainingBefore <= 0) {
      const ended = this.endGame(winnerFromColor(otherColor(color)), Termination.Timeout, now);
      this.zeroClock(color);
      return {
        ok: false,
        reason: "Flagged on time",
        illegalCount: this.illegalCountFor(color),
        illegalLimit: ILLEGAL_MOVE_LIMIT,
        ended,
      };
    }

    let chessMove: ChessJsMove | null = null;
    try {
      // For M2 the raw input is already SAN. Voice parsing happens in M3
      // upstream of this call.
      chessMove = this.chess.move(raw);
    } catch {
      chessMove = null;
    }

    if (!chessMove) {
      if (color === Color.White) this.illegalCount.white += 1;
      else this.illegalCount.black += 1;
      const count = this.illegalCountFor(color);
      let ended: GameEndInfo | null = null;
      if (count >= ILLEGAL_MOVE_LIMIT) {
        ended = this.endGame(winnerFromColor(otherColor(color)), Termination.IllegalStrikes, now);
      }
      return {
        ok: false,
        reason: "Illegal or unparseable move",
        illegalCount: count,
        illegalLimit: ILLEGAL_MOVE_LIMIT,
        ended,
      };
    }

    const incrementMs = this.timeControl.incrementSeconds * 1000;
    const newClock = Math.max(0, remainingBefore) + incrementMs;
    if (color === Color.White) this.whiteClockMs = newClock;
    else this.blackClockMs = newClock;
    this.lastMoveAt = now;

    const msFromStart = now - this.startedAt.getTime();
    const record: MoveRecord = {
      san: chessMove.san,
      uci: `${chessMove.from}${chessMove.to}${chessMove.promotion ?? ""}`,
      raw,
      msFromStart,
      whiteClockMs: this.whiteClockMs,
      blackClockMs: this.blackClockMs,
    };
    this.moves.push(record);

    for (const listener of this.moveListeners) {
      try {
        const r = listener(this, record);
        if (r instanceof Promise) {
          r.catch((err: unknown) => {
            logger.error("move listener failed", { gameId: this.id, err: String(err) });
          });
        }
      } catch (err) {
        logger.error("move listener threw", { gameId: this.id, err: String(err) });
      }
    }

    const ended = this.checkTerminalState(color, now);
    return { ok: true, move: record, ended };
  }

  resign(byUserId: string, now: number = Date.now()): GameEndInfo | null {
    if (this.status !== "active") return null;
    const color = this.userColor(byUserId);
    if (color === null) return null;
    return this.endGame(winnerFromColor(otherColor(color)), Termination.Resignation, now);
  }

  offerDraw(byUserId: string): { ok: boolean; reason?: string } {
    if (this.status !== "active") return { ok: false, reason: "Game is not active" };
    const color = this.userColor(byUserId);
    if (color === null) return { ok: false, reason: "Not a player in this game" };
    if (this.drawOfferBy === color) return { ok: true };
    this.drawOfferBy = color;
    return { ok: true };
  }

  acceptDraw(byUserId: string, now: number = Date.now()): GameEndInfo | null {
    if (this.status !== "active") return null;
    const color = this.userColor(byUserId);
    if (color === null) return null;
    if (this.drawOfferBy === null) return null;
    // A player cannot accept their own offer; the opponent must accept.
    if (this.drawOfferBy === color) return null;
    return this.endGame(GameResult.Draw, Termination.AgreedDraw, now);
  }

  tick(now: number = Date.now()): GameEndInfo | null {
    if (this.status !== "active") return null;
    const turn = this.turn();
    const clock = turn === Color.White ? this.whiteClockMs : this.blackClockMs;
    if (clock - (now - this.lastMoveAt) <= 0) {
      const ended = this.endGame(winnerFromColor(otherColor(turn)), Termination.Timeout, now);
      this.zeroClock(turn);
      return ended;
    }
    return null;
  }

  private illegalCountFor(color: Color): number {
    return color === Color.White ? this.illegalCount.white : this.illegalCount.black;
  }

  private zeroClock(color: Color): void {
    if (color === Color.White) this.whiteClockMs = 0;
    else this.blackClockMs = 0;
  }

  private checkTerminalState(mover: Color, now: number): GameEndInfo | null {
    if (this.chess.isCheckmate()) {
      // chess.js flips turn after the move, so the side-to-move is now the
      // loser; the mover is the winner.
      return this.endGame(winnerFromColor(mover), Termination.Checkmate, now);
    }
    if (this.chess.isStalemate()) {
      return this.endGame(GameResult.Draw, Termination.Stalemate, now);
    }
    if (this.chess.isThreefoldRepetition()) {
      return this.endGame(GameResult.Draw, Termination.ThreefoldRepetition, now);
    }
    if (this.chess.isInsufficientMaterial()) {
      return this.endGame(GameResult.Draw, Termination.InsufficientMaterial, now);
    }
    if (this.chess.isDrawByFiftyMoves()) {
      return this.endGame(GameResult.Draw, Termination.FiftyMoveRule, now);
    }
    if (this.chess.isDraw()) {
      // Fallback bucket for any other chess.js-detected draw condition.
      return this.endGame(GameResult.Draw, Termination.Stalemate, now);
    }
    return null;
  }

  private endGame(result: GameResult, termination: Termination, now: number): GameEndInfo {
    if (this.status === "ended") {
      return { result: this.result ?? result, termination: this.termination ?? termination };
    }
    this.status = "ended";
    this.result = result;
    this.termination = termination;
    this.endedAt = new Date(now);
    const info: GameEndInfo = { result, termination };
    for (const listener of this.endListeners) {
      try {
        const r = listener(this);
        if (r instanceof Promise) {
          r.catch((err: unknown) => {
            logger.error("end listener failed", { gameId: this.id, err: String(err) });
          });
        }
      } catch (err) {
        logger.error("end listener threw", { gameId: this.id, err: String(err) });
      }
    }
    return info;
  }
}
