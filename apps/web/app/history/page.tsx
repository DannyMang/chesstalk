import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import {
  gamesCollection,
  getDb,
  getInternalUserIdForClerkUserId,
  getUsernamesById,
} from "../../lib/db.ts";

type Outcome = "W" | "L" | "D" | "—";

function outcome(
  result: "white" | "black" | "draw" | null,
  yourColor: "white" | "black",
): Outcome {
  if (!result) return "—";
  if (result === "draw") return "D";
  return result === yourColor ? "W" : "L";
}

function outcomeBadgeClass(res: Outcome): string {
  if (res === "W") {
    return "border-[#9fca6b]/40 bg-[#3c4a2e] text-[#d4f0aa]";
  }
  if (res === "L") {
    return "border-[#b58863]/50 bg-[#3a2f28] text-[#f0d9b5]";
  }
  return "border-[#4a4640] bg-[#3c3934] text-[#cfc8bd]";
}

function modeLabel(mode: "easy" | "blindfold"): string {
  return mode === "easy" ? "Easy" : "Blindfold";
}

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function HistoryPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const db = await getDb();
  const internalUserId = await getInternalUserIdForClerkUserId(db, userId);
  if (!internalUserId) {
    return <EmptyHistory />;
  }

  const games = gamesCollection(db);
  const docs = await games
    .find({
      $or: [
        { "white.userId": internalUserId, "black.userId": { $not: /^bot:/ } },
        { "black.userId": internalUserId, "white.userId": { $not: /^bot:/ } },
      ],
    })
    .sort({ endedAt: -1 })
    .limit(50)
    .toArray();
  const usernamesById = await getUsernamesById(
    db,
    docs.flatMap((doc) => [doc.white.userId, doc.black.userId]),
  );

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Match history</h1>
        <p className="text-sm text-[#9b948a]">
          Your last 50 games, with opponent and game ID.
        </p>
      </header>

      {docs.length === 0 ? (
        <div className="rounded bg-[#262421] p-8 text-center text-[#9b948a]">
          No games yet.{" "}
          <Link href="/play" className="text-[#9fca6b] underline underline-offset-4">
            Play your first
          </Link>
          .
        </div>
      ) : (
        <div className="overflow-hidden rounded bg-[#262421] shadow-xl shadow-black/30">
          <table className="w-full text-sm">
            <thead className="bg-[#1f1e1b] text-left text-xs uppercase tracking-[0.2em] text-[#9b948a]">
              <tr>
                <th className="px-4 py-3">Opponent</th>
                <th className="px-4 py-3">Game ID</th>
                <th className="px-4 py-3">Mode</th>
                <th className="px-4 py-3">Color</th>
                <th className="px-4 py-3">Result</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => {
                const yourColor: "white" | "black" =
                  doc.white.userId === internalUserId ? "white" : "black";
                const opponent = yourColor === "white" ? doc.black : doc.white;
                const opponentName =
                  usernamesById.get(opponent.userId) ?? opponent.username;
                const id = doc._id;
                const res = outcome(doc.result, yourColor);
                return (
                  <tr
                    key={id}
                    className="border-t border-[#3c3934] hover:bg-[#2f2d29]"
                  >
                    <td className="px-4 py-3 font-medium">{opponentName}</td>
                    <td className="px-4 py-3 font-mono text-xs text-[#9b948a]">
                      {id.slice(0, 8)}
                    </td>
                    <td className="px-4 py-3">{modeLabel(doc.mode)}</td>
                    <td className="px-4 py-3 capitalize">{yourColor}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block w-6 rounded border text-center font-mono font-semibold ${outcomeBadgeClass(res)}`}>
                        {res}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#9b948a]">
                      {formatDate(doc.endedAt ? new Date(doc.endedAt) : null)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/game/${id}`}
                        className="text-xs text-[#9fca6b] underline underline-offset-4"
                      >
                        Replay
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function EmptyHistory() {
  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Match history</h1>
        <p className="text-sm text-[#9b948a]">Your last 50 games.</p>
      </header>
      <div className="rounded bg-[#262421] p-8 text-center text-[#9b948a]">
        No games yet.{" "}
        <Link href="/play" className="text-[#9fca6b] underline underline-offset-4">
          Play your first
        </Link>
        .
      </div>
    </section>
  );
}
