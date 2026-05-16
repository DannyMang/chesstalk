"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import { useEffect, useState } from "react";

const links = [
  { href: "/play", label: "Play", primary: true },
  { href: "/history", label: "Game History" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/settings", label: "Settings" },
  { href: "/profile", label: "Profile" },
];

export function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <header className="border-b border-black/20 bg-[#1f1e1b] shadow-sm lg:fixed lg:inset-y-0 lg:left-0 lg:z-20 lg:w-44 lg:border-b-0 lg:border-r">
      <div className="mx-auto flex w-full max-w-7xl flex-col px-4 py-3 sm:px-6 lg:h-full lg:flex-col lg:items-stretch lg:px-4 lg:py-5">
        <div className="flex items-center justify-between lg:block">
          <Link href="/" className="text-lg font-semibold tracking-tight text-[#f5f3ef] lg:mb-6 lg:block">
            ChessTalk
          </Link>
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded border border-white/10 text-[#f5f3ef] hover:bg-[#2b2926] lg:hidden"
            aria-label="Toggle navigation menu"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <span className="sr-only">Menu</span>
            <span className="flex flex-col gap-1.5" aria-hidden="true">
              <span className="block h-0.5 w-5 rounded bg-current" />
              <span className="block h-0.5 w-5 rounded bg-current" />
              <span className="block h-0.5 w-5 rounded bg-current" />
            </span>
          </button>
        </div>
        <div className={`${open ? "flex" : "hidden"} flex-col gap-3 pt-4 lg:flex lg:flex-1 lg:pt-0`}>
          <nav className="flex flex-col gap-1 text-sm text-[#cfc8bd] lg:flex-1 lg:items-stretch">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded px-2 py-2 hover:bg-[#2b2926] ${
                  link.primary
                    ? "font-semibold text-[#9fca6b] hover:text-[#b7df7f]"
                    : "hover:text-white"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3 border-t border-white/10 pt-3 lg:flex-col lg:items-stretch lg:border-t-0 lg:pt-0">
          <SignedIn>
            <UserButton afterSignOutUrl="/" />
          </SignedIn>
          <SignedOut>
            <Link
              href="/sign-in"
              className="rounded bg-[#3c3934] px-3 py-1.5 text-sm text-[#f5f3ef] hover:bg-[#4a4640]"
            >
              Sign in
            </Link>
          </SignedOut>
          </div>
        </div>
      </div>
    </header>
  );
}
