import type { ServerGameMessage } from "@chesstalk/shared/wire";
import type { GameActor } from "./game-actor.ts";

export type DispatchResult =
  | { ok: true }
  | { ok: false; reason: string; illegalCount: number; terminal: boolean };

// Single entry point for applying a proposed move to a live game and
// emitting the protocol-level broadcasts. Both `/game` (typed/board move)
// and `/audio` (parsed verbal move) feed through here so the wire output
// stays identical regardless of source.
export function dispatchMove(
  game: GameActor,
  userId: string,
  raw: string,
  now: number = Date.now(),
): DispatchResult {
  const result = game.proposeMove(userId, raw, now);

  if (result.ok) {
    const clocks = game.clockSnapshot(now);
    const msg: ServerGameMessage = {
      type: "move:confirmed",
      gameId: game.id,
      move: result.move,
      fen: game.chess.fen(),
      turn: game.turn(),
      whiteClockMs: clocks.whiteClockMs,
      blackClockMs: clocks.blackClockMs,
    };
    game.broadcast(msg);
    // game:end broadcast (on checkmate / draw / illegal-strikes / timeout)
    // is fired by the onEnd listener attached at game-start.
    return { ok: true };
  }

  const color = game.userColor(userId);
  if (color !== null) {
    const rejection: ServerGameMessage = {
      type: "move:rejected",
      gameId: game.id,
      reason: result.reason,
      illegalCount: result.illegalCount,
    };
    game.sendTo(color, rejection);
  }

  return {
    ok: false,
    reason: result.reason,
    illegalCount: result.illegalCount,
    terminal: result.ended !== null,
  };
}
