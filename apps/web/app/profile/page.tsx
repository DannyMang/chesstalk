import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Mode } from "@chesstalk/shared";
import {
  ensureUserProfile,
  getDb,
  getRatingForClerkUserId,
} from "../../lib/db.ts";
import { ProfileNameForm } from "./name-form.tsx";

export default async function ProfilePage() {
  const user = await currentUser();
  if (!user) {
    redirect("/sign-in");
  }

  const fallbackName =
    user.username ??
    user.firstName ??
    user.emailAddresses[0]?.emailAddress ??
    "Player";
  const db = await getDb();
  const userDoc = await ensureUserProfile(db, user.id, fallbackName);
  const displayName = userDoc.username;
  const [easyRating, blindfoldRating] = await Promise.all([
    getRatingForClerkUserId(db, user.id, Mode.Easy),
    getRatingForClerkUserId(db, user.id, Mode.Blindfold),
  ]);

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">{displayName}</h1>
        <p className="text-sm text-[#9b948a]">Your ChessTalk profile</p>
      </header>
      <ProfileNameForm
        currentName={displayName}
        changesUsed={userDoc?.nameChangesUsed ?? 0}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <article className="rounded bg-[#262421] p-6 shadow">
          <h2 className="text-sm font-medium text-[#9b948a]">Easy rating</h2>
          <p className="mt-2 text-4xl font-semibold">{Math.round(easyRating)}</p>
        </article>
        <article className="rounded bg-[#262421] p-6 shadow">
          <h2 className="text-sm font-medium text-[#9b948a]">
            Blindfold rating
          </h2>
          <p className="mt-2 text-4xl font-semibold">
            {Math.round(blindfoldRating)}
          </p>
        </article>
      </div>
    </section>
  );
}
