# ChessTalk — Planning Document

A verbal chess web app. Players speak their moves out loud; the server validates and relays. Two modes: **easy** (board visible) and **blindfold** (only opponent's last move shown). Lichess-style time controls (5+0, 10+0). Open source, ~100 expected users at launch.

---

## 1. Key Design Decisions (TL;DR)

| Area | Decision | Why |
|---|---|---|
| Transport between players | **WebSockets, not WebRTC** | Opponents must not hear each other, so peer audio is unwanted. WebRTC buys nothing here. |
| Speech-to-Text | **Deepgram Nova-3 streaming** (server-side), Web Speech API as fallback | Only vendor with strong per-turn vocabulary biasing ("keyterm prompting") — the single biggest accuracy lever for "knight vs night", "Nf3 vs enough three". Sub-300 ms partials, ~$0.0043/min. |
| Move parsing | Go voice normalizer + **notnil/chess** legality | The Go server normalizes common spoken move forms, then validates against the authoritative game state. |
| Board UI | **react-chessboard 5.x** | Active, React-native, MIT, supports last-move highlight + disabling drag (needed for "voice-only"). chessground is GPL-3.0; only use if we accept GPL for the whole app. |
| Engine | **Stockfish 18 (WASM)** — v2 feature only | Not needed for PvP. Used later for blunder analysis in match replay, optional hint feature, and a future bot mode. |
| Rating | **Glicko-1**, start at **1200** | Pure ELO converges too slowly; Glicko-2's volatility math needs more games than we'll have. Glicko-1 = right complexity for our scale. 1200 gives headroom in both directions and converges faster than 800 with a thin user base. |
| Matchmaking | Per-pool expanding-window queue (±50 every 10 s, cap ±400) | 4 pools = mode × time control. Pools will be thin — offer opt-in time-control expansion + a bot fallback after 60 s. |
| Database | **MongoDB Atlas** (per spec) | Schema flexibility for match documents + native TTL indexes for the 7-week eviction. |
| Auth | **Clerk** (per spec) | Stores Clerk `userId` as the foreign key everywhere. |
| Real-time server | **Go WebSocket server** on **Railway** | Vercel is ideal for the web app, while Railway can run the long-lived WebSocket process. Goroutines and mutex-protected game actors fit the launch concurrency model. |
| Mid-game disconnects | **10 s reconnect grace, then opponent wins** | Chess.com-style behavior: brief grace for flaky mobile/network drops, but the waiting player is not held hostage. If the game never progressed past move 0, record it as a resignation-style early exit. |
| Voice privacy | **No peer audio.** STT happens server-side; opponent gets parsed text (+ optional TTS) | Hard requirement from spec. Also simplifies anti-cheat (server sees the audio path). |
| OSS split | Public app monorepo + private infra repo | Mirrors Lichess (`lila` public, ops private). |

---

## 2. System Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  Browser (Next.js client, Clerk auth)                                │
│  ┌──────────────┐  ┌────────────────┐  ┌──────────────────────────┐ │
│  │ Lobby /      │  │ Game UI        │  │ Mic capture (own turn)   │ │
│  │ Matchmaking  │  │ (react-        │  │ getUserMedia → Opus 20ms │ │
│  │              │  │  chessboard)   │  │ → WS audio frames        │ │
│  └──────────────┘  └────────────────┘  └──────────────────────────┘ │
└────────────┬──────────────────┬───────────────────┬─────────────────┘
             │ HTTPS (Next.js)  │ WS /game           │ WS /audio
             │                  │                    │
   ┌─────────▼────────┐  ┌──────▼──────────┐  ┌──────▼──────────────┐
   │ Next.js API      │  │ Game server     │  │ STT worker          │
   │ (Vercel)         │  │ (Railway: Go WS)│  │ (Railway worker)    │
   │  - profile       │  │                 │  │  - holds Deepgram   │
   │  - history list  │  │  - matchmaking  │  │    socket per game  │
   │  - replay fetch  │  │  - per-game     │  │  - legal-move       │
   │  - leaderboard   │  │    state        │  │    keyterms each    │
   │                  │  │  - notnil/chess │  │    turn             │
   │                  │  │  - clocks       │  │  - voice parser     │
   └────────┬─────────┘  │  - ratings      │  └──────────┬──────────┘
            │            └────────┬────────┘             │
            │                     │  (in-proc or         │
            │                     │   WS callback)       │
            │                     │ ◄────────────────────┘
            ▼                     ▼
   ┌────────────────────────────────────────────────────┐
   │ MongoDB Atlas                                      │
   │  - users, ratings, games (TTL 7w), match summaries │
   └────────────────────────────────────────────────────┘
```

The **STT worker** and **Game server** can be the same Go process for v1 (simpler). Split later if STT load grows.

---

## 3. Voice Pipeline (the hard part)

Per turn:

1. **Game server** announces "your turn, white" to player A over `/game` WS. Player B's UI just shows the clock and "waiting".
2. **Player A's browser** starts `getUserMedia` (mic was pre-authorized on game start). Streams Opus chunks over `/audio` WS to STT worker.
3. **Game server** computes `chess.moves({ verbose: true })` → the set of legal SAN moves from this position. Builds a Deepgram keyterm list:
   - Every legal SAN: `["Nf3", "Bxe5", "O-O", "O-O-O", "e4", ...]`
   - Every legal move in NL form via chess-nlp: `["knight to f3", "bishop takes e5", "castles kingside", ...]`
   - **NATO phonetic for files**: `"alpha"="a"`, `"bravo"="b"`, `"charlie"="c"`, `"delta"="d"`, `"echo"="e"`, `"foxtrot"="f"`, `"golf"="g"`, `"hotel"="h"`. (Lichess discovered this fixes a huge chunk of file-recognition errors.)
   - Common chess words: `"check"`, `"mate"`, `"takes"`, `"captures"`, `"promotes"`, `"queen"`, etc.
   - Pushes this keyterm list to STT worker.
4. **STT worker** sends `KeytermPrompt` to Deepgram for this turn's session.
5. As Deepgram returns **interim transcripts**, worker forwards them to player A's UI for live feedback ("knight to e..." → "knight to e4").
6. On `is_final` + endpointing, worker runs:
   - **Normalization** (lowercase, "night"→"knight", "be"→"b", "ate"→"8", strip filler).
   - **chess-nlp** `textToSan(normalized)` → candidate SAN.
   - **notnil/chess** validates legality.
7. **If valid**: emit `move-confirmed` to game server → updates state, broadcasts to both players, swaps turn, resets clock. Opponent's UI shows the move as text and (optionally) speaks it via `SpeechSynthesis`.
8. **If invalid / unparseable**: increment `illegalCount[playerId]`. Reply to player A: "Couldn't parse — try again" or "Illegal move, 1 of 3". On 3rd strike → player A loses, game ends, broadcast result.

### Audio gating

- `getUserMedia` once at game start (avoid mid-game permission prompts).
- Toggle `track.enabled` based on turn (server-confirmed, not local guess).
- **Manual audio toggle setting**: when enabled, mic is only hot while user holds a push-to-talk key (default: spacebar). Default off (automatic per-turn).

### "Your turn" UI affordance

When the turn flips to the local player, the UI needs to be unmistakable. The active-player surface has three layers:

1. **Whole-screen state change** — board border / page accent shifts to the player's color, opponent's panel dims, the clock for the active player gets a subtle pulse. The user should know it's their turn from peripheral vision alone.
2. **Voice capsule (live mic component)** — a prominent pill-shaped component at the bottom-center of the screen with:
   - A live **audio waveform** visualizing the user's mic input in real time (driven by `AnalyserNode` from the Web Audio API, ~60fps canvas render of frequency bins).
   - Above/inside the capsule, the **live interim transcript** from Deepgram updates as the user speaks: `"knight..."` → `"knight to..."` → `"knight to e4"`. Renders the partial in a muted color, snaps to a confident color on `is_final`.
   - Subtle prompt copy when idle: *"Your move — say it out loud"* or, for manual-audio users, *"Hold space and speak"*.
   - Color-coded states: idle (gray) → listening (active color, animated waveform) → parsing (brief shimmer) → confirmed (green flash) or rejected (red flash + "couldn't parse, try again — 1 of 3").
3. **Opponent's screen** — the inverse: their voice capsule is collapsed/dimmed, their clock is static, a "waiting on opponent…" affordance appears. They should never wonder whose turn it is.

In **blindfold mode**, the voice capsule and turn-state cues become *the entire UI* (no board), so they need to carry even more visual weight — full-width capsule, larger waveform, larger clocks.

The capsule component lives in `/app/components/voice-capsule.tsx` and is the centerpiece of the in-game experience.

### Fallback

- Detect Firefox or Web Speech availability. If Deepgram is down or user opts out, use browser-side `SpeechRecognition` with the same normalization → Go voice parser → notnil/chess layer. Worse accuracy, no biasing.

---

## 4. Data Model (MongoDB)

```
users
  _id: ObjectId
  clerkUserId: string (unique index)
  username: string (display name)
  createdAt: Date
  settings: {
    manualAudio: boolean (default false)
    ttsAnnouncements: boolean (default true)
    preferredColor: "white" | "black" | "random"
  }

ratings
  _id: ObjectId
  userId: ObjectId (ref users) — index
  mode: "easy" | "blindfold" — index
  rating: number (default 1200)
  rd: number (Glicko deviation, default 350)
  games: number (default 0)
  updatedAt: Date
  // compound unique index: (userId, mode)

games  // TTL 7 weeks
  _id: ObjectId
  mode: "easy" | "blindfold"
  timeControl: { initial: 300|600, increment: 0 }  // seconds
  white: { userId, ratingBefore, ratingAfter }
  black: { userId, ratingBefore, ratingAfter }
  result: "white" | "black" | "draw" | null
  termination: "checkmate" | "resignation" | "timeout" | "illegal_strikes" | "disconnect" | "draw_*"
  pgn: string                                     // standard PGN, replayable by chess libraries
  moves: [                                        // for replay UI
    {
      san: string,                                // "Nf3"
      uci: string,                                // "g1f3"
      raw: string,                                // "knight to f three" (what player said, for transparency)
      msFromStart: number,
      whiteClockMs: number,
      blackClockMs: number
    }
  ]
  illegalCount: { white: number, black: number }
  startedAt: Date
  endedAt: Date
  expiresAt: Date  // TTL index: db.games.createIndex({expiresAt:1},{expireAfterSeconds:0})

queue  // ephemeral, in-memory on game server, not persisted
  // { userId, mode, timeControl, rating, joinedAt }
```

### Why these choices

- **`moves[]` separately from PGN** — PGN gives you a portable replay, but the per-move clock state and the *raw verbal transcript* are valuable for users (replay debugging, transparency that we heard them right) and not part of standard PGN.
- **TTL on `games`** — MongoDB's `expireAfterSeconds: 0` on an `expiresAt` field is the canonical eviction pattern; set `expiresAt = endedAt + 7 weeks` at game completion.
- **Rating stored separately** from `users` — allows independent updates per mode without doc rewrites, and lets you fetch leaderboards by `(mode, rating)` index without loading user docs.

---

## 5. Rating System (Glicko-1)

**Starting rating = 1200**, separate per mode.

Glicko-1 parameters:

- Rating period: per game (simpler than batching; fine at our scale).
- New player: `rating=1200, RD=350`.
- After each game, update both players using Glicko-1 formulas (q = ln(10)/400 ≈ 0.00575).
- RD decays toward 350 over time (cap on inactive players' confidence).

Implementation: a single `rateGame(white, black, result)` function in the game server. ~50 LOC. No external library needed; we'll write and test it directly.

---

## 6. Matchmaking

Four pools: `(easy, 5min)`, `(easy, 10min)`, `(blindfold, 5min)`, `(blindfold, 10min)`.

**Algorithm** (per pool, runs in the game server, polls every 1 s):

1. Sort waiting users by `joinedAt`.
2. For each user, compute current acceptance window: `±(50 + 50 * floor(secondsWaited / 10))`, capped at `±400`.
3. Pair the longest-waiting user with the closest-rating opponent within the window.
4. After 30 s waiting, prompt the user "no match yet — also search 10min?" (opt-in expansion across time-control pools, **never across modes**).
5. After 60–90 s, offer a "play against bot" option (uses Stockfish at a difficulty matched to their rating — v2 feature).

No external matchmaking lib. ~80 LOC. Revisit at 10k+ DAU.

---

## 7. Game Flow

1. **Lobby** — user clicks "Play easy 5+0". Joins queue. Lobby shows "queuing… N players online".
2. **Match found** — both clients receive `game-start` with `gameId`, color, opponent username/rating.
3. **Pre-game** — both clients call `getUserMedia` and join the game WS room. Server starts white's clock.
4. **Turn cycle** — voice pipeline (Section 3). On every move: server updates state, persists incremental move to MongoDB, broadcasts to both.
5. **End conditions** — checkmate / stalemate / draw (notnil/chess detects) / timeout (server timer) / resignation (button: "say 'I resign' or click") / 3 illegal strikes.
6. **Post-game** — show result, rating delta, link to replay. Both `ratings` rows updated. `games` doc finalized with `expiresAt`.

### Disconnect / reconnect policy

Use a Chess.com-style grace period rather than keeping disconnected games alive indefinitely:

1. If a player's `/game` WebSocket drops after `game:start`, the server detaches that socket and marks the player as disconnected.
2. The disconnected player gets **10 seconds** to reconnect with the same Clerk/guest identity and send `game:resume` for the active `gameId`.
3. During the grace window, the opponent remains in-game and sees a reconnecting/abandoned-game countdown. The authoritative game clock can keep running, but the disconnect adjudication timer is separate so a network drop does not create an unbounded wait.
4. If the player reconnects in time, the server reattaches the new socket, sends a fresh full `game:state` snapshot (FEN, clocks, all moves, illegal counts), and clears the disconnect timer.
5. If the grace window expires, the opponent wins automatically. Use a distinct disconnect/abandonment termination for games with at least one move; if **no moves have been played**, record the result as a resignation-style early exit.
6. This v1 policy is single-process only. Multi-server deployments need sticky routing or shared game/session state before reconnect can be reliable across instances.

### Blindfold mode UI

- No board rendered.
- Show: clocks, your color, last opponent move (in text + optional spoken aloud once), move count, "your turn / opponent's turn".
- Optional setting: speak the *full move list* aloud on demand (button: "repeat moves").

### Match replay

- Fetch `games` doc by `_id` (auth: only if user was a player).
- Reconstruct position by stepping through `moves[]` and applying to a fresh chess engine instance.
- UI: chessboard + forward/back buttons + move list (chess.com style). Highlight last move.
- "Show what I said" toggle reveals the `raw` transcript per move.

---

## 8. Open Source / Infrastructure Split

Two repos:

### `chesstalk` (public, MIT or AGPL — see below)

- Next.js app (`/app`)
- Game server (`/server`)
- Shared types/game logic (`/shared`)
- Docker `compose.yml` for local dev: Next + game server + Mongo + (optionally) a stub STT worker that uses Web Speech API only
- `.env.example` with every key documented (`CLERK_PUBLISHABLE_KEY`, `MONGODB_URI`, `DEEPGRAM_API_KEY`, ...) and dummy values
- `README.md` "run locally in 3 commands"
- `SECURITY.md`, `CONTRIBUTING.md`, `docs/self-hosting.md`
- License: **AGPL-3.0** (matches Lichess; prevents proprietary fork-and-host without contributing back).

### `chesstalk-infra` (private)

- Terraform/Pulumi: Atlas cluster, Railway service, Vercel project, DNS, Cloudflare
- Production env files (encrypted with SOPS or stored only in Railway/Vercel dashboards)
- Runbooks, on-call docs
- Anti-cheat thresholds, abuse-response procedures (publishing these = publishing the bypass)

### Secrets

- `.env.local` gitignored.
- Local dev: dummy keys work for everything except STT — provide a Web-Speech-API-only fallback so contributors don't need a Deepgram key.
- Production secrets live in Vercel + Railway env stores. Never in either repo.

---

## 9. Tech Stack Summary

| Layer | Choice | License |
|---|---|---|
| Web framework | Next.js 15 (App Router) | MIT |
| Auth | Clerk | proprietary SaaS |
| Database | MongoDB Atlas | SSPL (server) / various drivers |
| Real-time server | Go WebSocket server on Railway | BSD-style stdlib + Gorilla WebSocket |
| Board UI | react-chessboard 5.x | MIT |
| Game logic | notnil/chess | MIT |
| Move NL parser | chess-nlp (vendored + extended) | MIT |
| Speech-to-Text | Deepgram Nova-3 + Web Speech API fallback | SaaS / browser-native |
| Future engine | Stockfish 18 (WASM) | GPL-3.0 (load only as analysis; isolate behind API to keep main app license clean) |
| Hosting | Vercel (web) + Railway (game/STT server) + MongoDB Atlas | — |
| CI | GitHub Actions | — |

---

## 10. Implementation Milestones

### M1 — Skeleton (week 1)
- Next.js scaffold, Clerk auth, MongoDB connection, basic profile page.
- Public/private repo structure, `.env.example`, README, local Docker compose.

### M2 — Single-player vs self, no voice (week 2)
- Game server (Go + WebSockets), one game between two browser tabs.
- notnil/chess integration, react-chessboard, clocks, move-by-move broadcast.
- `games` doc persisted, replay UI works.

### M3 — Voice in easy mode (week 3)
- Mic capture, push-to-server audio WS, Deepgram integration, keyterm prompting per turn.
- Go voice parsing + normalization + notnil/chess validation.
- 3-strikes illegal move rule.
- **Voice capsule component**: live waveform (Web Audio `AnalyserNode` + canvas) + live interim transcript + turn-state colors.
- Whole-screen "your turn" affordance (board accent, opponent dim, clock pulse).
- TTS for opponent's move (browser `SpeechSynthesis`).

### M4 — Blindfold mode + ratings (week 4)
- Blindfold UI (no board) — voice capsule becomes the centerpiece, larger waveform.
- Glicko-1 implementation, rating updates, per-mode rating display.
- Profile page shows rating, history list.

### M5 — Matchmaking + lobby (week 5)
- 4 pools, expanding window, opt-in pool expansion.
- "N players online" indicator.
- Resign flow, draw offers.

### M6 — Polish + launch prep (week 6)
- Manual audio toggle setting.
- Web Speech API fallback path (Firefox/no-key).
- Match-history replay with raw-transcript toggle.
- 7-week TTL verified working.
- Self-hosting docs.

### Post-launch (v2+)
- Stockfish blunder analysis in replay.
- Bot opponent mode (matchmaking fallback).
- Mobile app (React Native / Expo, sharing the `/shared` package).
- Spectator mode (read-only WS subscribers).
- Tournament/arena mode.
- Sound packs, themes.

---

## 11. Open Questions / Risks

1. **chess-nlp is unmaintained.** Plan: vendor it into `/shared/voice-parser`, add tests against a corpus of "how chess players actually talk" (we'll need to build this — start by recording ourselves for 30 minutes). Likely we need to extend its grammar.
2. **Deepgram cost at scale.** ~$0.005/min × ~2 s/move × 40 moves/game × 100 users × heavy daily play ≈ $10–30/mo. Cheap at our size, monitor as usage grows.
3. **Safari/Firefox parity.** Web Speech API fallback covers Firefox poorly. Document this clearly; consider whisper.cpp WASM in v2.
4. **Anti-cheat.** Verbal chess is harder to bot than text chess (you'd need TTS → audio → captured), but engine assistance is still possible (player listens to engine, speaks the move). Deferring detection to v2 — note in private infra repo what heuristics we use.
5. **The "delta 2 to delta 4" problem.** Single-square-name moves (e.g. "e4") confuse STT engines on accents. Lichess solved this by requiring NATO phonetic + source square for pawn moves. We should support both NATO and natural ("knight to e4") — and confirm ambiguous parses back to the user ("did you mean Nf3 or Nh3? say 'first' or 'second'").
6. **Latency budget.** End-to-end ≤1 s = mic-to-Deepgram (~50 ms) + Deepgram processing (~300 ms) + parse+validate (<10 ms) + WS hop to opponent (~50 ms) + render (~50 ms) ≈ 460 ms typical. Achievable. Watch worst-case (Deepgram cold-start, network jitter).

---

## 12. Next Steps

Once this plan is approved, I'd start M1: scaffold Next.js + Clerk + Mongo + the two-repo structure, and write the `.env.example` + README so the OSS scaffold is right from commit #1.


## 13. Private Friend Links

Users should be able to create a private invite link and send it to a friend. The rough v1 flow is:

1. Player A chooses mode + time control and clicks **Create friend link**.
2. Server creates an in-memory invite ID and returns it to Player A.
3. Player A shares `/play?invite=<inviteId>`.
4. Player B opens the link, authenticates with Clerk, and joins that invite.
5. Server starts a normal `GameActor` with the selected mode/time control. The game uses the same rules, voice path, clocks, illegal move strikes, rating updates, and match history persistence as matchmaking games.

For v1, invites can be ephemeral and stored in the game server process. Later, move them to Mongo or Redis if we need multi-instance servers, invite expiration after restarts, or pending invite pages.


Production STT

 Choose STT provider for production, likely Deepgram Nova-3.

 Add server-side STT streaming instead of dev transcript input.

 Add chess keyterm prompting for piece names, squares, captures, castling, promotion.

 Handle interim transcript updates in the voice capsule.

 Add timeout/retry/error states for failed recognition.

 Add privacy note: opponent never receives audio.
Production Infra

 Decide hosting split: web app, WebSocket server, MongoDB Atlas.

 Add production env var docs.

 Add deployment docs for self-hosting.

 Add Dockerfile or deployment config for server.

 Add health checks for web, server, Mongo, and STT.

 Add basic observability: logs, request IDs, game IDs.
Scaled Matchmaking

 Replace in-memory queues with Redis or Mongo-backed queues.

 Add rating-window expansion over time.

 Add reconnect handling for dropped WebSocket clients: 10 s same-identity `game:resume`, full state snapshot on success.

 Add abandoned-game cleanup: after the reconnect grace expires, award the opponent a win; move-0 disconnects are recorded as resignation-style exits.

 Add multi-server game routing strategy.

 Add bot fallback when queue wait is too long.
UI Polish

 Finish Lichess-like spacing and color consistency.

 Polish mobile /play layout.

 Improve blindfold mode screen.

 Add clearer turn state and illegal move warnings.

 Improve history/replay visuals.

 Add loading/empty/error states across dashboard pages.
Deployment Hardening

 Add rate limits for auth, game actions, transcript events, and invites.

 Validate all WebSocket messages with schemas.

 Add origin checks for WebSocket connections.

 Add production-safe Clerk JWT verification config.

 Add Mongo indexes migration/check command to setup docs.

 Add CI for typecheck, tests, and lint.

 Add smoke tests for bot game, guest game, and replay.