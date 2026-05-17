import Link from "next/link";

export const dynamic = "force-dynamic";

export default function StatusPage() {
  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <header className="rounded bg-[#262421] p-6 shadow-xl shadow-black/30">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#9fca6b]">
          ChessTalk Status
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">
          Service status and maintenance
        </h1>
        <p className="mt-3 text-sm text-[#cfc8bd]">
          If games are stuck connecting, profile data is stale, or history does not load,
          we may be restarting infrastructure or waiting on MongoDB, Railway, Clerk, or
          Deepgram to recover.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <article className="rounded bg-[#262421] p-5 shadow">
          <h2 className="text-lg font-bold">Current guidance</h2>
          <p className="mt-2 text-sm text-[#cfc8bd]">
            If you are seeing reloads or connection errors, wait a minute and refresh.
            Active games may reconnect automatically if the game server is still running.
          </p>
        </article>
        <article className="rounded bg-[#262421] p-5 shadow">
          <h2 className="text-lg font-bold">What can be affected</h2>
          <p className="mt-2 text-sm text-[#cfc8bd]">
            Multiplayer pairing, invite links, voice transcription, ratings, leaderboard,
            game history, and replay pages depend on external services.
          </p>
        </article>
      </div>

      <section className="rounded bg-[#262421] p-5 shadow-xl shadow-black/30">
        <h2 className="text-lg font-bold">Quick checks</h2>
        <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-sm text-[#cfc8bd]">
          <li>Refresh the page after a short wait.</li>
          <li>Try a bot game to confirm the game server is reachable.</li>
          <li>Use typed moves if voice transcription is unavailable.</li>
          <li>Check back here if a maintenance window is announced.</li>
        </ul>
      </section>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/play"
          className="rounded bg-[#7fa650] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#8fbd5f]"
        >
          Back to play
        </Link>
        <Link
          href="/"
          className="rounded border border-[#4a4640] px-5 py-2.5 text-sm text-[#cfc8bd] hover:bg-[#2f2d29] hover:text-white"
        >
          Home
        </Link>
      </div>
    </section>
  );
}
