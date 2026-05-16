import Link from "next/link";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getDb, usersCollection } from "../../lib/db.ts";

export default async function SettingsPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const db = await getDb();
  const userDoc = await usersCollection(db).findOne({ clerkUserId: user.id });
  const settings = userDoc?.settings ?? {
    manualAudio: false,
    ttsAnnouncements: true,
    preferredColor: "random",
  };

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <header>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-sm text-[#9b948a]">
          Current account and game preferences. Editing controls are next.
        </p>
      </header>

      <div className="rounded bg-[#262421] p-5 shadow-xl shadow-black/30">
        <h2 className="text-lg font-bold">Game Preferences</h2>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded bg-[#312e2b] p-4">
            <dt className="text-[#9b948a]">Manual audio</dt>
            <dd className="mt-1 font-semibold">{settings.manualAudio ? "On" : "Off"}</dd>
          </div>
          <div className="rounded bg-[#312e2b] p-4">
            <dt className="text-[#9b948a]">TTS announcements</dt>
            <dd className="mt-1 font-semibold">
              {settings.ttsAnnouncements ? "On" : "Off"}
            </dd>
          </div>
          <div className="rounded bg-[#312e2b] p-4">
            <dt className="text-[#9b948a]">Preferred color</dt>
            <dd className="mt-1 font-semibold capitalize">{settings.preferredColor}</dd>
          </div>
          <div className="rounded bg-[#312e2b] p-4">
            <dt className="text-[#9b948a]">Account</dt>
            <dd className="mt-1 truncate font-semibold">{user.emailAddresses[0]?.emailAddress ?? user.id}</dd>
          </div>
        </dl>
      </div>

      <div className="rounded bg-[#262421] p-5 text-sm text-[#cfc8bd]">
        Settings persistence exists in Mongo, but the form controls are still a rough-draft TODO.
        <Link href="/play" className="ml-2 text-[#9fca6b] hover:text-[#b7df7f]">
          Back to play
        </Link>
      </div>
    </section>
  );
}
