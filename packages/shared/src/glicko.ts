// Glicko-1 rating system.
// Mark Glickman, "Parameter estimation in large dynamic paired comparison
// experiments" (1999). Per-game rating-period simplification: each game is
// its own rating period with a single opponent.

const Q = Math.log(10) / 400; // ≈ 0.00575646273

export interface GlickoRating {
  rating: number;
  rd: number;
}

export type GameOutcome = 1 | 0 | 0.5; // 1 = win, 0 = loss, 0.5 = draw

function g(rd: number): number {
  return 1 / Math.sqrt(1 + (3 * Q * Q * rd * rd) / (Math.PI * Math.PI));
}

function expectedScore(rating: number, opponent: GlickoRating): number {
  return 1 / (1 + Math.pow(10, (-g(opponent.rd) * (rating - opponent.rating)) / 400));
}

export interface GlickoUpdate {
  rating: number;
  rd: number;
}

// Update `player` after one game against `opponent` with the given outcome
// (from the player's perspective). Returns the new rating + RD.
export function updateRating(
  player: GlickoRating,
  opponent: GlickoRating,
  outcome: GameOutcome,
): GlickoUpdate {
  const gOpp = g(opponent.rd);
  const e = expectedScore(player.rating, opponent);
  const dSquared = 1 / (Q * Q * gOpp * gOpp * e * (1 - e));
  const denom = 1 / (player.rd * player.rd) + 1 / dSquared;
  const newRd = Math.sqrt(1 / denom);
  const newRating = player.rating + Q * (newRd * newRd) * gOpp * (outcome - e);
  return {
    rating: Math.round(newRating),
    rd: Math.max(30, Math.round(newRd)),
  };
}

// Inactivity bump for an idle player. Call before a new game if the player
// hasn't played in a while. Increases RD up to the cap (default 350).
export function decayRd(rd: number, ratingPeriodsIdle: number, c = 34.6, cap = 350): number {
  const next = Math.sqrt(rd * rd + c * c * ratingPeriodsIdle);
  return Math.min(cap, Math.round(next));
}
