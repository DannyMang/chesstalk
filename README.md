# ChessTalk

Verbal chess. Speak your moves out loud — the system parses them, validates legality, and relays them to your opponent.

Two modes:
- **Easy** — board is visible, like a normal chess UI.
- **Blindfold** — no board, only the opponent's last move is shown. Train your visualization.

 ([AGPL-3.0](LICENSE)).

## Quick start (local dev)

Requires [Bun](https://bun.sh), Go 1.22+, and Docker.

```sh
git clone https://github.com/YOUR-ORG/chesstalk.git
cd chesstalk
cp .env.example .env.local
# fill in CLERK keys (free tier at https://dashboard.clerk.com)
bun install
docker compose up -d mongo
bun run dev:server   # Go WebSocket server in one terminal
bun run dev:web      # in another
```

Open <http://localhost:3000>.

Live speech-to-text uses Deepgram streaming when `DEEPGRAM_API_KEY` is set. Without a key, the in-game voice capsule still includes a **test spoken move** input that sends text through the `/audio` path, runs the Go verbal move normalizer, and dispatches the parsed move.

The Go backend is now the only server implementation. It supports guest games, Clerk JWKS verification, matchmaking, invites, clocks, legal-move validation, Mongo game persistence, Deepgram streaming STT, and Stockfish-backed bot games. Production hardening still needs rating updates.

## Repository layout

```
apps/
  web/        Next.js 15 app — UI, auth, profile, replay
  server-go/  Go WebSocket server — game state, matchmaking, STT proxy
packages/
  shared/     Types, enums, game logic shared between apps
docs/
  self-hosting.md
```

See [docs/self-hosting.md](docs/self-hosting.md) for production deployment notes.

## How it works

1. You hit "Play easy 5+0", join a matchmaking queue.
2. When matched, both players' browsers open a WebSocket to the game server. The game server holds authoritative state.
3. On your turn, your browser can capture mic audio and stream WebM/Opus chunks to the server. With `DEEPGRAM_API_KEY`, the server proxies those chunks to Deepgram Nova-3 and forwards interim/final transcripts back through the voice capsule; the dev transcript box exercises the same parser/dispatcher path without live STT.
4. Your opponent never hears your voice — they only see the parsed move appear.

See [PLAN.md](PLAN.md) for full architecture, data model, and milestones.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). For security issues, see [SECURITY.md](SECURITY.md).
