# Self-hosting ChessTalk

ChessTalk is designed to run as two long-lived services plus a database:

| Service | Recommended host | Notes |
|---|---|---|
| `apps/web` (Next.js) | Vercel | Stateless web app and server-rendered pages |
| `apps/server-go` (Go WebSocket server) | Railway | Must hold WebSockets; single-region is fine at small scale |
| MongoDB | MongoDB Atlas (free tier covers ~100 users) or self-hosted | Needs the `games.expiresAt` TTL index — see below |

## Environment

Copy `.env.example` to `.env.local` (local) or set the same keys in Vercel/Railway env-var stores (production). Required:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` — Clerk auth.
- `NEXT_PUBLIC_GAME_SERVER_URL` — public `wss://...` URL of the Railway game server, set in Vercel.
- `MONGODB_URI` — Mongo connection string, set in both Vercel and Railway.
- `DEEPGRAM_API_KEY` — optional locally, required in Railway before production STT.
- `ALLOWED_ORIGINS` — comma-separated browser origins allowed to open game/audio WebSockets, set in Railway.
- `CLERK_JWKS_URL` — Clerk JWKS endpoint for verifying WebSocket tokens in Railway.
- `CLERK_ISSUER` — expected Clerk issuer. Recommended for production.
- `CLERK_AUDIENCE` — optional comma-separated JWT audiences if you configure one.
- `CLERK_AUTHORIZED_PARTIES` — optional comma-separated allowed `azp` origins, usually your Vercel URL.

## MongoDB indexes

The Go game server creates indexes on startup:

- `users.clerkUserId` — unique
- `ratings.{userId, mode}` — compound unique
- `games.expiresAt` — TTL (`expireAfterSeconds: 0`) for the 7-week eviction
- `games.{white.userId, endedAt}`, `games.{black.userId, endedAt}` — history queries

Verify in MongoDB Atlas or with `mongosh` after first boot.

## Railway

The root `Dockerfile` builds `apps/server-go` and `railway.json` points Railway at `/health`. Railway provides `$PORT`; the Go server uses it automatically, falling back to `GAME_SERVER_PORT` for local development.

After deploy, run:

```sh
scripts/smoke-health.sh https://<your-railway-domain>
```

## Scaling notes

- The game server holds per-game state in memory. To run multiple instances you need sticky sessions on the WS load balancer **and** a shared Redis for matchmaking (not yet implemented — file an issue if you need it).
- At ~100 users, one small Railway service should be enough. Keep the game server single-region until shared matchmaking/reconnect routing exists.

## What's intentionally not in this repo

Production Terraform, runbooks, on-call procedures, and anti-cheat thresholds live in a private operations repo. You are welcome to write your own; the app code makes no assumptions about your deployment topology.
