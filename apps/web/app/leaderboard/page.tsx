import Link from "next/link";
import { Mode, STARTING_RATING } from "@chesstalk/shared";
import { getDb, ratingsCollection, usersCollection } from "../../lib/db.ts";

interface LeaderboardRow {
  userId: string;
  username: string;
  easy: number;
  blindfold: number;
}

export default async function LeaderboardPage() {
  const db = await getDb();
  const users = await usersCollection(db).find({}).limit(100).toArray();
  const ratings = await ratingsCollection(db).find({}).toArray();
  const byUser = new Map<string, LeaderboardRow>();

  for (const user of users) {
    byUser.set(user._id, {
      userId: user._id,
      username: user.username,
      easy: STARTING_RATING,
      blindfold: STARTING_RATING,
    });
  }

  for (const rating of ratings) {
    const row = byUser.get(rating.userId);
    if (!row) continue;
    if (rating.mode === Mode.Easy) row.easy = rating.rating;
    if (rating.mode === Mode.Blindfold) row.blindfold = rating.rating;
  }

  const rows = Array.from(byUser.values())
    .sort((a, b) => Math.max(b.easy, b.blindfold) - Math.max(a.easy, a.blindfold))
    .slice(0, 25);

  return (
    <section className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Leaderboard</h1>
          <p className="text-sm text-[#9b948a]">Current top players by rating.</p>
        </div>
        <Link href="/play" className="rounded bg-[#7fa650] px-4 py-2 font-semibold text-white">
          Play
        </Link>
      </header>

      <div className="overflow-hidden rounded bg-[#262421] shadow-xl shadow-black/30">
        <table className="w-full text-sm">
          <thead className="bg-[#1f1e1b] text-left text-xs uppercase tracking-[0.2em] text-[#9b948a]">
            <tr>
              <th className="px-4 py-3">#</th>
              <th className="px-4 py-3">Player</th>
              <th className="px-4 py-3">Easy</th>
              <th className="px-4 py-3">Blindfold</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#3c3934]">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-[#9b948a]">
                  No rated games yet.
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => (
                <tr key={row.userId} className="hover:bg-[#2f2d29]">
                  <td className="px-4 py-3 font-mono text-[#9b948a]">{idx + 1}</td>
                  <td className="px-4 py-3 font-semibold">{row.username}</td>
                  <td className="px-4 py-3 font-mono">{Math.round(row.easy)}</td>
                  <td className="px-4 py-3 font-mono">{Math.round(row.blindfold)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
