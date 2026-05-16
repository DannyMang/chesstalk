import type { Color, GameResult, Mode, Termination, TimeControl } from "./enums.ts";
import type { MoveRecord } from "./types.ts";

// Messages from client → server on the /game WebSocket.
export type ClientGameMessage =
  | { type: "queue:join"; mode: Mode; timeControl: TimeControl }
  | { type: "queue:leave" }
  | { type: "bot:start"; mode: Mode; timeControl: TimeControl; side?: Color; strength?: number }
  | { type: "invite:create"; mode: Mode; timeControl: TimeControl }
  | { type: "invite:join"; inviteId: string }
  | { type: "game:resign"; gameId: string }
  | { type: "game:offerDraw"; gameId: string }
  | { type: "game:acceptDraw"; gameId: string }
  | { type: "move:propose"; gameId: string; raw: string }
  | { type: "ping"; t: number };

// Messages from server → client on the /game WebSocket.
export type ServerGameMessage =
  | { type: "queue:waiting"; mode: Mode; timeControl: TimeControl; queueDepth: number }
  | { type: "invite:created"; inviteId: string; mode: Mode; timeControl: TimeControl }
  | { type: "game:start"; gameId: string; color: Color; opponent: OpponentInfo; mode: Mode; timeControl: TimeControl }
  | { type: "game:state"; gameId: string; fen: string; turn: Color; whiteClockMs: number; blackClockMs: number; lastMove: MoveRecord | null }
  | { type: "move:confirmed"; gameId: string; move: MoveRecord; fen: string; turn: Color; whiteClockMs: number; blackClockMs: number }
  | { type: "move:rejected"; gameId: string; reason: string; illegalCount: number }
  | { type: "game:end"; gameId: string; result: GameResult; termination: Termination; ratingDeltaSelf: number; ratingDeltaOpponent: number }
  | { type: "pong"; t: number; serverNow: number }
  | { type: "error"; code: string; message: string };

export interface OpponentInfo {
  userId: string;
  username: string;
  rating: number;
}

// Audio path (separate WebSocket). Audio frames are sent as binary
// Opus packets; control messages are JSON.
export type ClientAudioMessage =
  | { type: "audio:start"; gameId: string }
  | { type: "audio:stop"; gameId: string }
  | { type: "audio:transcript"; gameId: string; text: string };

export type ServerAudioMessage =
  | { type: "stt:interim"; gameId: string; text: string }
  | { type: "stt:final"; gameId: string; text: string }
  | { type: "stt:error"; gameId: string; message: string };
