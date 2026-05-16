import { notFound, redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import type { GameDoc, MoveRecord } from "@chesstalk/shared";
import {
  gamesCollection,
  getDb,
  getInternalUserIdForClerkUserId,
  getUsernamesById,
} from "../../../lib/db.ts";
import { Replay } from "./replay.tsx";

interface ReplayPageProps {
  params: Promise<{ id: string }>;
}

export default async function ReplayPage({ params }: ReplayPageProps) {
  const { id } = await params;
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const db = await getDb();
  const internalUserId = await getInternalUserIdForClerkUserId(db, userId);
  if (!internalUserId) redirect("/history");

  const games = gamesCollection(db);
  const doc = await games.findOne({ _id: id });
  if (!doc) notFound();

  if (
    doc.white.userId !== internalUserId &&
    doc.black.userId !== internalUserId
  ) {
    redirect("/history");
  }

  const yourColor: "white" | "black" =
    doc.white.userId === internalUserId ? "white" : "black";
  const opponent = yourColor === "white" ? doc.black : doc.white;
  const usernamesById = await getUsernamesById(db, [opponent.userId]);
  const opponentUsername = usernamesById.get(opponent.userId) ?? opponent.username;

  const moves: MoveRecord[] = doc.moves;
  const summary: GameDoc = doc;

  return (
    <Replay
      gameId={summary._id}
      moves={moves}
      yourColor={yourColor}
      opponentUsername={opponentUsername}
      mode={summary.mode}
      result={summary.result}
    />
  );
}
