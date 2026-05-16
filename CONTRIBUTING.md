# Contributing to ChessTalk

Thanks for your interest. This project is small and early — bug reports, design feedback, and PRs are all welcome.

## Local setup

See the [README](README.md). Local dev runs against a Docker Mongo and Clerk's free tier. A Deepgram key is optional — without one, the app uses the browser's Web Speech API.

## Project structure

- `apps/web` — Next.js 15 app (App Router).
- `apps/server` — Fastify + ws game server.
- `packages/shared` — types, enums, and game logic shared across apps.

Run `bun install` once at the repo root; Bun workspaces link everything.

## Conventions

- TypeScript strict mode everywhere.
- ESM only (no CommonJS).
- Format with the default Bun/Biome settings (no Prettier).
- Don't add comments that just re-describe what the code does.

## Commits and PRs

- Keep PRs focused — one concern per PR.
- Reference the milestone (M1..M6) in the PR title if applicable (e.g. `M3: voice capsule live waveform`).
- A passing `bun run typecheck` is required.

## What we won't accept

- Anti-cheat heuristic implementations in public PRs (we keep these in a private repo on purpose).
- New runtime dependencies without a brief note in the PR explaining why a smaller approach won't work.
- Cosmetic refactors unbundled from a feature or bug fix.
