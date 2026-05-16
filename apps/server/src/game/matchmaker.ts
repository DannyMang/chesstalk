import { Color, type Mode, type TimeControl } from "@chesstalk/shared/enums";
import type { OpponentInfo } from "@chesstalk/shared/wire";
import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import { GameActor } from "./game-actor.ts";

interface Waiter {
  userId: string;
  ws: WebSocket;
  opponentInfo: OpponentInfo;
  mode: Mode;
  timeControl: TimeControl;
  joinedAt: number;
}

interface PairedSide {
  userId: string;
  ws: WebSocket;
  color: Color;
  opponent: OpponentInfo;
}

export interface MatchResult {
  matched: true;
  game: GameActor;
  self: PairedSide;
  other: PairedSide;
}

export type EnqueueResult = { matched: false } | MatchResult;

function poolKey(mode: Mode, tc: TimeControl): string {
  return `${mode}|${tc.initialSeconds}+${tc.incrementSeconds}`;
}

export class Matchmaker {
  private readonly pools: Map<string, Waiter> = new Map();
  // Reverse index so leave() can find a user's pool without a scan.
  private readonly userToPool: Map<string, string> = new Map();

  enqueue(
    userId: string,
    ws: WebSocket,
    mode: Mode,
    timeControl: TimeControl,
    opponentInfo: OpponentInfo,
  ): EnqueueResult {
    const key = poolKey(mode, timeControl);
    const waiter = this.pools.get(key);

    if (waiter && waiter.userId !== userId) {
      this.pools.delete(key);
      this.userToPool.delete(waiter.userId);

      const now = Date.now();
      const newcomerIsWhite = Math.random() < 0.5;
      const whiteSide = newcomerIsWhite
        ? { userId, ws, info: opponentInfo }
        : { userId: waiter.userId, ws: waiter.ws, info: waiter.opponentInfo };
      const blackSide = newcomerIsWhite
        ? { userId: waiter.userId, ws: waiter.ws, info: waiter.opponentInfo }
        : { userId, ws, info: opponentInfo };

      const game = new GameActor({
        id: randomUUID(),
        mode,
        timeControl,
        white: {
          userId: whiteSide.info.userId,
          username: whiteSide.info.username,
          ratingBefore: whiteSide.info.rating,
          ratingAfter: null,
        },
        black: {
          userId: blackSide.info.userId,
          username: blackSide.info.username,
          ratingBefore: blackSide.info.rating,
          ratingAfter: null,
        },
        now,
      });

      const newcomerColor: Color = newcomerIsWhite ? Color.White : Color.Black;
      const waiterColor: Color = newcomerIsWhite ? Color.Black : Color.White;

      const self: PairedSide = {
        userId,
        ws,
        color: newcomerColor,
        opponent: waiter.opponentInfo,
      };
      const other: PairedSide = {
        userId: waiter.userId,
        ws: waiter.ws,
        color: waiterColor,
        opponent: opponentInfo,
      };

      return { matched: true, game, self, other };
    }

    // Replace any existing same-user waiter (e.g. reconnect / mode switch).
    if (waiter && waiter.userId === userId) {
      this.pools.delete(key);
      this.userToPool.delete(userId);
    }
    const existingPool = this.userToPool.get(userId);
    if (existingPool && existingPool !== key) {
      this.pools.delete(existingPool);
      this.userToPool.delete(userId);
    }

    this.pools.set(key, {
      userId,
      ws,
      opponentInfo,
      mode,
      timeControl,
      joinedAt: Date.now(),
    });
    this.userToPool.set(userId, key);
    return { matched: false };
  }

  leave(userId: string): void {
    const key = this.userToPool.get(userId);
    if (!key) return;
    const waiter = this.pools.get(key);
    if (waiter && waiter.userId === userId) {
      this.pools.delete(key);
    }
    this.userToPool.delete(userId);
  }

  depth(mode: Mode, timeControl: TimeControl): number {
    return this.pools.has(poolKey(mode, timeControl)) ? 1 : 0;
  }
}

export const matchmaker = new Matchmaker();
