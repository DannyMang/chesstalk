import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import type { GameDoc } from "@chesstalk/shared";
import {
  gamesCollection,
  getDb,
  getInternalUserIdForClerkUserId,
  getUsernamesById,
} from "../../../lib/db.ts";

export const dynamic = "force-dynamic";

export interface GameHistoryRow {
  id: string;
  mode: GameDoc["mode"];
  yourColor: "white" | "black";
  opponentUsername: string;
  result: GameDoc["result"];
  endedAt: string | null;
}

export async function GET(): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const internalUserId = await getInternalUserIdForClerkUserId(db, userId);
  if (!internalUserId) {
    return NextResponse.json({ rows: [] });
  }

  const games = gamesCollection(db);
  const docs = await games
    .find({
      $or: [
        { "white.userId": internalUserId },
        { "black.userId": internalUserId },
      ],
    })
    .sort({ endedAt: -1 })
    .limit(50)
    .toArray();
  const opponentIds = docs.map((doc) =>
    doc.white.userId === internalUserId ? doc.black.userId : doc.white.userId,
  );
  const usernamesById = await getUsernamesById(db, opponentIds);

  const rows = docs.map((doc): GameHistoryRow => {
    const yourColor: "white" | "black" =
      doc.white.userId === internalUserId ? "white" : "black";
    const opponent = yourColor === "white" ? doc.black : doc.white;
    return {
      id: doc._id,
      mode: doc.mode,
      yourColor,
      opponentUsername: usernamesById.get(opponent.userId) ?? opponent.username,
      result: doc.result,
      endedAt: doc.endedAt ? new Date(doc.endedAt).toISOString() : null,
    };
  });

  return NextResponse.json({ rows });
}
