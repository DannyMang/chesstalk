import "server-only";
import { MongoClient, type Db } from "mongodb";
import { randomUUID } from "node:crypto";
import { STARTING_RATING, type Mode } from "@chesstalk/shared";
import type { GameDoc, RatingDoc, UserDoc } from "@chesstalk/shared";

declare global {
  var __chesstalkMongo: { client: MongoClient; db: Db } | undefined;
}

export type GameDocumentRaw = GameDoc;
export type UserDocumentRaw = UserDoc;
export type RatingDocumentRaw = RatingDoc;

const DB_NAME = "chesstalk";

function buildClient(): { client: MongoClient; db: Db } {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not set");
  }
  const client = new MongoClient(uri);
  const db = client.db(DB_NAME);
  return { client, db };
}

export async function getDb(): Promise<Db> {
  if (!globalThis.__chesstalkMongo) {
    const handle = buildClient();
    await handle.client.connect();
    globalThis.__chesstalkMongo = handle;
  }
  return globalThis.__chesstalkMongo.db;
}

export function gamesCollection(db: Db) {
  return db.collection<GameDocumentRaw>("games");
}

export function usersCollection(db: Db) {
  return db.collection<UserDocumentRaw>("users");
}

export function ratingsCollection(db: Db) {
  return db.collection<RatingDocumentRaw>("ratings");
}

export async function ensureUserProfile(
  db: Db,
  clerkUserId: string,
  fallbackUsername: string,
): Promise<UserDocumentRaw> {
  const existing = await usersCollection(db).findOne({ clerkUserId });
  if (existing) {
    return {
      ...existing,
      nameChangesUsed: existing.nameChangesUsed ?? 0,
    };
  }

  const username = fallbackUsername.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 20);
  const safeUsername =
    username.length >= 3 ? username : `player_${clerkUserId.slice(-6)}`;
  const now = new Date();
  const row: UserDocumentRaw = {
    _id: randomUUID(),
    clerkUserId,
    username: safeUsername,
    nameChangesUsed: 0,
    createdAt: now,
    settings: {
      manualAudio: false,
      ttsAnnouncements: true,
      preferredColor: "random",
    },
  };

  try {
    await usersCollection(db).insertOne(row);
    return row;
  } catch {
    const after = await usersCollection(db).findOne({ clerkUserId });
    if (after) {
      return {
        ...after,
        nameChangesUsed: after.nameChangesUsed ?? 0,
      };
    }
    throw new Error(`Failed to create user profile ${clerkUserId}`);
  }
}

export async function getInternalUserIdForClerkUserId(
  db: Db,
  clerkUserId: string,
): Promise<string | null> {
  const user = await usersCollection(db).findOne(
    { clerkUserId },
    { projection: { _id: 1 } },
  );
  return user?._id ?? null;
}

export async function getUsernamesById(
  db: Db,
  userIds: string[],
): Promise<Map<string, string>> {
  const uniqueUserIds = Array.from(new Set(userIds));
  if (uniqueUserIds.length === 0) return new Map();

  const users = await usersCollection(db)
    .find(
      { _id: { $in: uniqueUserIds } },
      { projection: { _id: 1, username: 1 } },
    )
    .toArray();

  return new Map(users.map((user) => [user._id, user.username]));
}

export async function getRatingForClerkUserId(
  db: Db,
  clerkUserId: string,
  mode: Mode,
): Promise<number> {
  const internalUserId = await getInternalUserIdForClerkUserId(db, clerkUserId);
  if (!internalUserId) return STARTING_RATING;

  const rating = await ratingsCollection(db).findOne(
    { userId: internalUserId, mode },
    { projection: { rating: 1 } },
  );
  return rating?.rating ?? STARTING_RATING;
}

export async function getRecentGamesForInternalUserId(
  db: Db,
  internalUserId: string,
  limit = 5,
): Promise<GameDocumentRaw[]> {
  return gamesCollection(db)
    .find({
      $or: [
        { "white.userId": internalUserId },
        { "black.userId": internalUserId },
      ],
    })
    .sort({ endedAt: -1 })
    .limit(limit)
    .toArray();
}
