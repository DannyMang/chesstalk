import type { Db } from "mongodb";
// MATCH_HISTORY_TTL_DAYS from @chesstalk/shared documents the intended
// retention window. The `games` TTL index uses expireAfterSeconds: 0 because
// each document carries its own absolute `expiresAt` Date.
import { MATCH_HISTORY_TTL_DAYS } from "@chesstalk/shared";
import { closeDb, connectDb } from "./client.ts";

export async function ensureIndexes(db: Db): Promise<void> {
  void MATCH_HISTORY_TTL_DAYS;

  await db.collection("users").createIndex(
    { clerkUserId: 1 },
    { unique: true, name: "users_clerkUserId_unique" },
  );
  await db.collection("users").createIndex(
    { username: 1 },
    { unique: true, name: "users_username_unique" },
  );

  await db.collection("ratings").createIndex(
    { userId: 1, mode: 1 },
    { unique: true, name: "ratings_userId_mode_unique" },
  );

  await db.collection("games").createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0, name: "games_expiresAt_ttl" },
  );
  await db.collection("games").createIndex(
    { "white.userId": 1, endedAt: -1 },
    { name: "games_whiteUser_endedAt" },
  );
  await db.collection("games").createIndex(
    { "black.userId": 1, endedAt: -1 },
    { name: "games_blackUser_endedAt" },
  );
}

async function main(): Promise<void> {
  const { db } = await connectDb();
  await ensureIndexes(db);

  for (const name of ["users", "ratings", "games"]) {
    const indexes = await db.collection(name).indexes();
    process.stdout.write(`${name}:\n`);
    for (const idx of indexes) {
      process.stdout.write(`  ${JSON.stringify(idx)}\n`);
    }
  }

  await closeDb();
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    process.stderr.write(`check-indexes failed: ${String(err)}\n`);
    process.exit(1);
  });
}
