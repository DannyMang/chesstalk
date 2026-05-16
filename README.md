# ChessTalk

Verbal chess. Speak your moves out loud — the system parses them, validates legality, and relays them to your opponent.

Two modes:
- **Easy** — board is visible, like a normal chess UI.
- **Blindfold** — no board, only the opponent's last move is shown. Train your visualization.

 ([AGPL-3.0](LICENSE)).

## Quick start (local dev)

Requires [Bun](https://bun.sh) and Docker.

```sh
git clone https://github.com/YOUR-ORG/chesstalk.git
cd chesstalk
cp .env.example .env.local
# fill in CLERK keys (free tier at https://dashboard.clerk.com)
bun install
docker compose up -d mongo
bun run dev:server   # in one terminal
bun run dev:web      # in another
```

Open <http://localhost:3000>.

Real speech-to-text is still a TODO. For local testing, the in-game voice capsule includes a **test spoken move** input that sends text through the `/audio` path, runs the verbal move parser, and dispatches the parsed move.

## Repository layout

```
apps/
  web/        Next.js 15 app — UI, auth, profile, replay
  server/     Fastify + ws — game state, matchmaking, STT proxy
packages/
  shared/     Types, enums, game logic shared between apps
docs/
  self-hosting.md
```

See [docs/self-hosting.md](docs/self-hosting.md) for production deployment notes.

## How it works

1. You hit "Play easy 5+0", join a matchmaking queue.
2. When matched, both players' browsers open a WebSocket to the game server. The game server holds authoritative state.
3. On your turn, your browser can capture mic audio and stream it to the server. The current rough draft also has a dev transcript box so you can type phrases like "knight to f3" and exercise the same parser/dispatcher path without Deepgram.
4. Your opponent never hears your voice — they only see the parsed move appear.

See [PLAN.md](PLAN.md) for full architecture, data model, and milestones.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). For security issues, see [SECURITY.md](SECURITY.md).
