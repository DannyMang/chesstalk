import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { ensureUserProfile, getDb, usersCollection } from "../../../../lib/db.ts";

const MAX_CHANGES = 3;
const NAME_RE = /^[a-zA-Z0-9_-]{3,20}$/;

export async function POST(req: Request): Promise<NextResponse> {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { username?: unknown } | null;
  const username = typeof body?.username === "string" ? body.username.trim() : "";

  if (!NAME_RE.test(username)) {
    return NextResponse.json(
      { error: "Name must be 3-20 characters: letters, numbers, _ or -" },
      { status: 400 },
    );
  }

  const db = await getDb();
  const users = usersCollection(db);
  const fallbackName =
    user.username ??
    user.firstName ??
    user.emailAddresses[0]?.emailAddress ??
    "Player";
  const existing = await ensureUserProfile(db, user.id, fallbackName);

  const used = existing.nameChangesUsed ?? 0;
  if (existing.username === username) {
    return NextResponse.json({ ok: true });
  }
  if (used >= MAX_CHANGES) {
    return NextResponse.json({ error: "You have used all 3 name changes" }, { status: 403 });
  }

  const taken = await users.findOne({ username, _id: { $ne: existing._id } });
  if (taken) {
    return NextResponse.json({ error: "That name is already taken" }, { status: 409 });
  }

  await users.updateOne(
    { _id: existing._id },
    {
      $set: { username },
      $inc: { nameChangesUsed: 1 },
    },
  );

  return NextResponse.json({ ok: true });
}
