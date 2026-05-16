import { Mode, STARTING_RATING } from "@chesstalk/shared/enums";
import type { UserDoc } from "@chesstalk/shared/types";
import type { Db } from "mongodb";
import { randomUUID } from "node:crypto";
import { ensureRatingRow } from "./persistence.ts";

interface UserRow {
  _id: string;
  clerkUserId: string;
  username: string;
  nameChangesUsed?: number;
  createdAt: Date;
  settings: UserDoc["settings"];
}

export async function ensureUserExists(
  db: Db,
  clerkUserId: string,
  fallbackUsername: string,
): Promise<UserDoc> {
  const users = db.collection<UserRow>("users");
  const existing = await users.findOne({ clerkUserId });
  if (existing) {
    return {
      _id: existing._id,
      clerkUserId: existing.clerkUserId,
      username: existing.username,
      nameChangesUsed: existing.nameChangesUsed ?? 0,
      createdAt: existing.createdAt,
      settings: existing.settings,
    };
  }

  const now = new Date();
  const row: UserRow = {
    _id: randomUUID(),
    clerkUserId,
    username: fallbackUsername,
    nameChangesUsed: 0,
    createdAt: now,
    settings: {
      manualAudio: false,
      ttsAnnouncements: true,
      preferredColor: "random",
    },
  };

  try {
    await users.insertOne(row);
  } catch {
    // A concurrent insert (unique index on clerkUserId) is possible. Re-read.
    const after = await users.findOne({ clerkUserId });
    if (after) {
      return {
        _id: after._id,
        clerkUserId: after.clerkUserId,
        username: after.username,
        nameChangesUsed: after.nameChangesUsed ?? 0,
        createdAt: after.createdAt,
        settings: after.settings,
      };
    }
    throw new Error(`Failed to upsert user ${clerkUserId}`);
  }

  await Promise.all([
    ensureRatingRow(db, row._id, Mode.Easy),
    ensureRatingRow(db, row._id, Mode.Blindfold),
  ]);

  return {
    _id: row._id,
    clerkUserId: row.clerkUserId,
    username: row.username,
    nameChangesUsed: row.nameChangesUsed ?? 0,
    createdAt: row.createdAt,
    settings: row.settings,
  };
}

// Read the current rating for a user in a given mode. Used to populate
// OpponentInfo at queue time.
export async function getRatingFor(
  db: Db,
  userId: string,
  mode: Mode,
): Promise<number> {
  const row = await db
    .collection<{ rating: number }>("ratings")
    .findOne({ userId, mode });
  return row?.rating ?? STARTING_RATING;
}
