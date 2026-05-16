# Self-hosting ChessTalk

ChessTalk is designed to run as two long-lived services plus a database:

| Service | Recommended host | Notes |
|---|---|---|
| `apps/web` (Next.js) | Vercel, Fly.io, Railway, or any Node host | Stateless |
| `apps/server` (Fastify + ws) | Fly.io, Railway, or a single VM | Must hold WebSockets; single-region is fine at small scale |
| MongoDB | MongoDB Atlas (free tier covers ~100 users) or self-hosted | Needs the `games.expiresAt` TTL index — see below |

## Environment

Copy `.env.example` to `.env.local` (local) or set the same keys in your host's env-var store (production). Required:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` — Clerk auth.
- `NEXT_PUBLIC_GAME_SERVER_URL` — public WSS URL of the game server.
- `MONGODB_URI` — Mongo connection string.
- `DEEPGRAM_API_KEY` — optional but strongly recommended for good STT.

## MongoDB indexes

The game server creates indexes on startup:

- `users.clerkUserId` — unique
- `ratings.{userId, mode}` — compound unique
- `games.expiresAt` — TTL (`expireAfterSeconds: 0`) for the 7-week eviction
- `games.{white.userId, endedAt}`, `games.{black.userId, endedAt}` — history queries

Verify by running `bun run --filter @chesstalk/server check-indexes` after first boot.

## Scaling notes

- The game server holds per-game state in memory. To run multiple instances you need sticky sessions on the WS load balancer **and** a shared Redis for matchmaking (not yet implemented — file an issue if you need it).
- At ~100 users, a single 256MB Fly machine is enough.

## What's intentionally not in this repo

Production Terraform, runbooks, on-call procedures, and anti-cheat thresholds live in a private operations repo. You are welcome to write your own; the app code makes no assumptions about your deployment topology.
