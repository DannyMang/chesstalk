"use client";

import { useState, useTransition } from "react";

const MAX_CHANGES = 3;

interface ProfileNameFormProps {
  currentName: string;
  changesUsed: number;
}

export function ProfileNameForm({ currentName, changesUsed }: ProfileNameFormProps) {
  const [name, setName] = useState(currentName);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const remaining = Math.max(0, MAX_CHANGES - changesUsed);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setMessage(null);
        setError(null);
        startTransition(async () => {
          const res = await fetch("/api/profile/name", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ username: name }),
          });
          const data = (await res.json()) as { ok?: boolean; error?: string };
          if (!res.ok || !data.ok) {
            setError(data.error ?? "Failed to update name");
            return;
          }
          setMessage("Name updated. Refreshing...");
          window.location.reload();
        });
      }}
      className="rounded bg-[#262421] p-5 shadow-xl shadow-black/30"
    >
      <div className="mb-4">
        <h2 className="text-lg font-bold">Display Name</h2>
        <p className="text-sm text-[#9b948a]">
          This name appears in games, leaderboards, and matchmaking. You can change it {remaining} more time{remaining === 1 ? "" : "s"}.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={remaining <= 0 || isPending}
          minLength={3}
          maxLength={20}
          className="min-w-0 flex-1 rounded border border-[#4a4640] bg-[#312e2b] px-3 py-2 text-[#f5f3ef] outline-none focus:border-[#7fa650] disabled:cursor-not-allowed disabled:opacity-60"
          placeholder="Your display name"
        />
        <button
          type="submit"
          disabled={remaining <= 0 || isPending || name.trim() === currentName}
          className="rounded bg-[#7fa650] px-5 py-2 font-semibold text-white hover:bg-[#8fbd5f] disabled:cursor-not-allowed disabled:bg-[#6b655d]"
        >
          {isPending ? "Saving..." : "Save name"}
        </button>
      </div>

      {error ? <p className="mt-3 text-sm text-[#ffb4a8]">{error}</p> : null}
      {message ? <p className="mt-3 text-sm text-[#d4f0aa]">{message}</p> : null}
    </form>
  );
}
