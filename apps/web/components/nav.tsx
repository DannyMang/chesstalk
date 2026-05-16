import Link from "next/link";
import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";

export function Nav() {
  return (
    <header className="border-b border-black/20 bg-[#1f1e1b] shadow-sm lg:fixed lg:inset-y-0 lg:left-0 lg:z-20 lg:w-44 lg:border-b-0 lg:border-r">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:h-full lg:flex-col lg:items-stretch lg:px-4 lg:py-5">
        <Link href="/" className="text-lg font-semibold tracking-tight text-[#f5f3ef] lg:mb-6">
          ChessTalk
        </Link>
        <nav className="flex items-center gap-4 text-sm text-[#cfc8bd] sm:gap-6 lg:flex-1 lg:flex-col lg:items-stretch lg:gap-1">
          <Link href="/play" className="rounded px-2 py-2 font-semibold text-[#9fca6b] hover:bg-[#2b2926] hover:text-[#b7df7f]">
            Play
          </Link>
          <Link href="/history" className="rounded px-2 py-2 hover:bg-[#2b2926] hover:text-white">
            Game History
          </Link>
          <Link href="/leaderboard" className="rounded px-2 py-2 hover:bg-[#2b2926] hover:text-white">
            Leaderboard
          </Link>
          <Link href="/settings" className="rounded px-2 py-2 hover:bg-[#2b2926] hover:text-white">
            Settings
          </Link>
          <Link href="/profile" className="rounded px-2 py-2 hover:bg-[#2b2926] hover:text-white">
            Profile
          </Link>
        </nav>
        <div className="flex items-center gap-3 lg:flex-col lg:items-stretch">
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
    </header>
  );
}
