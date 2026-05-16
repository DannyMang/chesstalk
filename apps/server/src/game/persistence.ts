import {
  GameResult,
  MATCH_HISTORY_TTL_DAYS,
  STARTING_RATING,
  STARTING_RD,
} from "@chesstalk/shared/enums";
import { type GameOutcome, updateRating } from "@chesstalk/shared/glicko";
import type { GameDoc, RatingDoc } from "@chesstalk/shared/types";
import type { Db } from "mongodb";
import { randomUUID } from "node:crypto";
import { logger } from "../logger.ts";
import type { GameActor } from "./game-actor.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

interface RatingsRow {
  _id?: string;
  userId: string;
  mode: string;
  rating: number;
  rd: number;
  games: number;
  updatedAt: Date;
}

async function loadRating(
  db: Db,
  userId: string,
  mode: string,
): Promise<{ rating: number; rd: number; games: number }> {
  const row = await db
    .collection<RatingsRow>("ratings")
    .findOne({ userId, mode });
  if (!row) {
    return { rating: STARTING_RATING, rd: STARTING_RD, games: 0 };
  }
  return { rating: row.rating, rd: row.rd, games: row.games };
}

export interface RatingUpdateResult {
  whiteBefore: number;
  blackBefore: number;
  whiteAfter: number;
  blackAfter: number;
}

export async function updateRatingsOnFinish(
  game: GameActor,
  db: Db,
): Promise<RatingUpdateResult> {
  if (game.result === null) {
    throw new Error(`Cannot update ratings: game ${game.id} has no result`);
  }

  const whiteCurrent = await loadRating(db, game.white.userId, game.mode);
  const blackCurrent = await loadRating(db, game.black.userId, game.mode);

  const outcomeForWhite: GameOutcome =
    game.result === GameResult.White ? 1 : game.result === GameResult.Black ? 0 : 0.5;
  const outcomeForBlack: GameOutcome = (1 - outcomeForWhite) as GameOutcome;

  const whiteUpdate = updateRating(
    { rating: whiteCurrent.rating, rd: whiteCurrent.rd },
    { rating: blackCurrent.rating, rd: blackCurrent.rd },
    outcomeForWhite,
  );
  const blackUpdate = updateRating(
    { rating: blackCurrent.rating, rd: blackCurrent.rd },
    { rating: whiteCurrent.rating, rd: whiteCurrent.rd },
    outcomeForBlack,
  );

  const now = new Date();
  await db.collection<RatingsRow>("ratings").updateOne(
    { userId: game.white.userId, mode: game.mode },
    {
      $set: {
        rating: whiteUpdate.rating,
        rd: whiteUpdate.rd,
        updatedAt: now,
      },
      $inc: { games: 1 },
      $setOnInsert: { userId: game.white.userId, mode: game.mode },
    },
    { upsert: true },
  );
  await db.collection<RatingsRow>("ratings").updateOne(
    { userId: game.black.userId, mode: game.mode },
    {
      $set: {
        rating: blackUpdate.rating,
        rd: blackUpdate.rd,
        updatedAt: now,
      },
      $inc: { games: 1 },
      $setOnInsert: { userId: game.black.userId, mode: game.mode },
    },
    { upsert: true },
  );

  game.white.ratingAfter = whiteUpdate.rating;
  game.black.ratingAfter = blackUpdate.rating;

  return {
    whiteBefore: whiteCurrent.rating,
    blackBefore: blackCurrent.rating,
    whiteAfter: whiteUpdate.rating,
    blackAfter: blackUpdate.rating,
  };
}

export async function persistFinishedGame(game: GameActor, db: Db): Promise<void> {
  if (game.status !== "ended" || game.result === null || game.termination === null) {
    throw new Error(`Cannot persist game ${game.id}: not in ended state`);
  }
  const endedAt = game.endedAt ?? new Date();
  const expiresAt = new Date(endedAt.getTime() + MATCH_HISTORY_TTL_DAYS * DAY_MS);

  const doc: GameDoc = {
    _id: game.id,
    mode: game.mode,
    timeControl: game.timeControl,
    white: { ...game.white },
    black: { ...game.black },
    result: game.result,
    termination: game.termination,
    pgn: game.chess.pgn(),
    moves: [...game.moves],
    illegalCount: { ...game.illegalCount },
    startedAt: game.startedAt,
    endedAt,
    expiresAt,
  };

  try {
    await db.collection<GameDoc>("games").insertOne(doc);
  } catch (err) {
    logger.error("persistFinishedGame insert failed", {
      gameId: game.id,
      err: String(err),
    });
    throw err;
  }
}

// Ensure a (userId, mode) row exists in `ratings`. Used at user creation so
// leaderboard queries have something to read even before the first game.
export async function ensureRatingRow(
  db: Db,
  userId: string,
  mode: RatingDoc["mode"],
): Promise<void> {
  await db.collection<RatingsRow>("ratings").updateOne(
    { userId, mode },
    {
      $setOnInsert: {
        _id: randomUUID(),
        userId,
        mode,
        rating: STARTING_RATING,
        rd: STARTING_RD,
        games: 0,
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );
}
