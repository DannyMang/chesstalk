import Link from "next/link";
import { currentUser } from "@clerk/nextjs/server";
import { Mode } from "@chesstalk/shared";
import {
  getDb,
  getInternalUserIdForClerkUserId,
  getRatingForClerkUserId,
  getRecentGamesForInternalUserId,
  getUsernamesById,
  type GameDocumentRaw,
} from "../lib/db.ts";

function BoardPreview() {
  return (
    <div className="mx-auto aspect-square w-full max-w-[560px] rounded shadow-2xl shadow-black/40">
      <div className="grid h-full w-full grid-cols-8 overflow-hidden rounded">
        {Array.from({ length: 64 }, (_, i) => {
          const row = Math.floor(i / 8);
          const col = i % 8;
          const dark = (row + col) % 2 === 1;
          return (
            <div
              key={i}
              className={dark ? "bg-[#b58863]" : "bg-[#f0d9b5]"}
            />
          );
        })}
      </div>
    </div>
  );
}

function resultLabel(result: string | null, yourColor: "white" | "black"): string {
  if (!result) return "In progress";
  if (result === "draw") return "Draw";
  return result === yourColor ? "Win" : "Loss";
}

export default async function HomePage() {
  const user = await currentUser();
  if (user) {
    const displayName =
      user.username ??
      user.firstName ??
      user.emailAddresses[0]?.emailAddress ??
      "Player";
    const db = await getDb();
    const internalUserId = await getInternalUserIdForClerkUserId(db, user.id);
    const [easyRating, blindfoldRating, recentGames] = await Promise.all([
      getRatingForClerkUserId(db, user.id, Mode.Easy),
      getRatingForClerkUserId(db, user.id, Mode.Blindfold),
      internalUserId ? getRecentGamesForInternalUserId(db, internalUserId, 4) : [],
    ]);
    const usernamesById = await getUsernamesById(
      db,
      recentGames.flatMap((game) => [game.white.userId, game.black.userId]),
    );

    return (
      <section className="flex flex-col gap-6">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-sm text-[#9b948a]">Welcome back</p>
            <h1 className="text-2xl font-bold">{displayName}</h1>
          </div>
          <Link
            href="/play"
            className="rounded bg-[#7fa650] px-5 py-2.5 font-semibold text-white hover:bg-[#8fbd5f]"
          >
            Play
          </Link>
        </header>

        <div className="rounded bg-[#262421] p-4 shadow-xl shadow-black/30">
          <div className="flex min-h-28 items-center justify-between rounded bg-[#7fa650] px-8 py-6 text-white">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] opacity-80">
                ChessTalk
              </p>
              <h2 className="text-3xl font-black">Speak your next move</h2>
            </div>
            <Link
              href="/play"
              className="rounded bg-white px-5 py-3 font-bold text-[#262421] shadow"
            >
              Play Now
            </Link>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[16rem_1fr_16rem]">
          <aside className="flex flex-col gap-3">
            <Link href="/play" className="rounded bg-[#262421] p-4 font-bold shadow hover:bg-[#2f2d29]">
              Play 10 min
            </Link>
            <Link href="/play" className="rounded bg-[#262421] p-4 font-bold shadow hover:bg-[#2f2d29]">
              New Game
            </Link>
            <Link href="/play?friend=1" className="rounded bg-[#262421] p-4 font-bold shadow hover:bg-[#2f2d29]">
              Play a Friend
            </Link>
            <Link href="/settings" className="rounded bg-[#262421] p-4 font-bold shadow hover:bg-[#2f2d29]">
              Settings
            </Link>
          </aside>

          <div className="grid gap-5 md:grid-cols-2">
            <article className="rounded bg-[#262421] p-5 shadow">
              <p className="text-sm text-[#9b948a]">Easy Rating</p>
              <p className="mt-2 text-4xl font-black">{Math.round(easyRating)}</p>
            </article>
            <article className="rounded bg-[#262421] p-5 shadow">
              <p className="text-sm text-[#9b948a]">Blindfold Rating</p>
              <p className="mt-2 text-4xl font-black">{Math.round(blindfoldRating)}</p>
            </article>

            <article className="rounded bg-[#262421] p-5 shadow md:col-span-2">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-bold">Game History</h2>
                <Link href="/history" className="text-sm text-[#9fca6b] hover:text-[#b7df7f]">
                  View all
                </Link>
              </div>
              {recentGames.length === 0 || !internalUserId ? (
                <p className="text-sm text-[#9b948a]">No games yet. Start one from Play.</p>
              ) : (
                <div className="flex flex-col divide-y divide-[#3c3934]">
                  {recentGames.map((game: GameDocumentRaw) => {
                    const yourColor =
                      game.white.userId === internalUserId ? "white" : "black";
                    const opponent =
                      yourColor === "white" ? game.black : game.white;
                    const opponentName =
                      usernamesById.get(opponent.userId) ?? opponent.username;
                    return (
                      <Link
                        key={game._id}
                        href={`/game/${game._id}`}
                        className="flex items-center justify-between gap-4 py-3 text-sm hover:text-white"
                      >
                        <span>
                          <span className="font-semibold">{opponentName}</span>
                          <span className="ml-2 font-mono text-xs text-[#9b948a]">
                            {game._id.slice(0, 8)}
                          </span>
                        </span>
                        <span className="rounded bg-[#3c3934] px-2 py-1 text-xs">
                          {resultLabel(game.result, yourColor)}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </article>
          </div>

          <aside className="flex flex-col gap-5">
            <Link href="/leaderboard" className="rounded bg-[#262421] p-5 shadow hover:bg-[#2f2d29]">
              <p className="text-sm text-[#9b948a]">Current</p>
              <h2 className="mt-1 text-xl font-bold">Leaderboard</h2>
            </Link>
            <Link href="/settings" className="rounded bg-[#262421] p-5 shadow hover:bg-[#2f2d29]">
              <p className="text-sm text-[#9b948a]">Game</p>
              <h2 className="mt-1 text-xl font-bold">Settings</h2>
            </Link>
          </aside>
        </div>
      </section>
    );
  }

  return (
    <section className="grid min-h-[calc(100vh-7rem)] items-center gap-10 py-8 lg:grid-cols-[minmax(360px,560px)_1fr]">
      <BoardPreview />

      <div className="flex flex-col items-center gap-7 text-center lg:items-start lg:text-left">
        <div>
          <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">
            Play chess by voice
          </h1>
          <p className="mt-4 max-w-xl text-lg text-[#cfc8bd]">
            Jump into a 5+0 or 10+0 game, no account required. Speak moves,
            test blindfold mode, or send a private link to a friend.
          </p>
        </div>
        <div className="flex w-full max-w-sm flex-col gap-3">
          <Link
            href="/play"
            className="rounded bg-[#7fa650] px-8 py-4 text-center text-xl font-semibold text-white shadow hover:bg-[#8fbd5f]"
          >
            Play now
          </Link>
          <Link
            href="/sign-in"
            className="rounded bg-[#3c3934] px-8 py-3 text-center font-medium text-[#f5f3ef] hover:bg-[#4a4640]"
          >
            Sign in for ratings
          </Link>
        </div>
      </div>
    </section>
  );
}
