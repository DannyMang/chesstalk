import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import { Nav } from "@/components/nav.tsx";
import "./globals.css";

export const metadata: Metadata = {
  title: "ChessTalk",
  description: "Verbal chess. Speak your moves out loud.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body className="min-h-screen bg-[#312e2b] text-[#f5f3ef] antialiased">
          <Nav />
          <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:pl-48">{children}</main>
        </body>
      </html>
    </ClerkProvider>
  );
}
