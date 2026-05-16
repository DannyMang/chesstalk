export const Mode = {
  Easy: "easy",
  Blindfold: "blindfold",
} as const;
export type Mode = (typeof Mode)[keyof typeof Mode];

export const TimeControlPreset = {
  Blitz5: "5+0",
  Rapid10: "10+0",
} as const;
export type TimeControlPreset = (typeof TimeControlPreset)[keyof typeof TimeControlPreset];

export interface TimeControl {
  initialSeconds: number;
  incrementSeconds: number;
}

export const TIME_CONTROLS: Record<TimeControlPreset, TimeControl> = {
  [TimeControlPreset.Blitz5]: { initialSeconds: 300, incrementSeconds: 0 },
  [TimeControlPreset.Rapid10]: { initialSeconds: 600, incrementSeconds: 0 },
};

export const Color = {
  White: "white",
  Black: "black",
} as const;
export type Color = (typeof Color)[keyof typeof Color];

export const GameResult = {
  White: "white",
  Black: "black",
  Draw: "draw",
} as const;
export type GameResult = (typeof GameResult)[keyof typeof GameResult];

export const Termination = {
  Checkmate: "checkmate",
  Resignation: "resignation",
  Timeout: "timeout",
  IllegalStrikes: "illegal_strikes",
  Disconnect: "disconnect",
  Stalemate: "draw_stalemate",
  ThreefoldRepetition: "draw_threefold",
  FiftyMoveRule: "draw_fifty",
  InsufficientMaterial: "draw_material",
  AgreedDraw: "draw_agreed",
} as const;
export type Termination = (typeof Termination)[keyof typeof Termination];

export const STARTING_RATING = 1200;
export const STARTING_RD = 350;
export const ILLEGAL_MOVE_LIMIT = 3;
export const MATCH_HISTORY_TTL_DAYS = 7 * 7; // 7 weeks
