import type { Color, GameResult, Mode, Termination, TimeControl } from "./enums.ts";

export interface UserDoc {
  _id: string;
  clerkUserId: string;
  username: string;
  nameChangesUsed: number;
  createdAt: Date;
  settings: UserSettings;
}

export interface UserSettings {
  manualAudio: boolean;
  ttsAnnouncements: boolean;
  preferredColor: Color | "random";
}

export interface RatingDoc {
  _id: string;
  userId: string;
  mode: Mode;
  rating: number;
  rd: number;
  games: number;
  updatedAt: Date;
}

export interface MoveRecord {
  san: string;
  uci: string;
  raw: string | null;
  msFromStart: number;
  whiteClockMs: number;
  blackClockMs: number;
}

export interface GamePlayerSnapshot {
  userId: string;
  username: string;
  ratingBefore: number;
  ratingAfter: number | null;
}

export interface GameDoc {
  _id: string;
  mode: Mode;
  timeControl: TimeControl;
  white: GamePlayerSnapshot;
  black: GamePlayerSnapshot;
  result: GameResult | null;
  termination: Termination | null;
  pgn: string;
  moves: MoveRecord[];
  illegalCount: { white: number; black: number };
  startedAt: Date;
  endedAt: Date | null;
  expiresAt: Date;
}
