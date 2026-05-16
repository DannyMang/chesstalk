#!/usr/bin/env bun

type Json = Record<string, unknown>;

const rawBase = process.argv[2] ?? process.env.GAME_SERVER_URL ?? process.env.NEXT_PUBLIC_GAME_SERVER_URL ?? "ws://localhost:8787";
const origin = process.env.SMOKE_ORIGIN ?? "http://localhost:3000";
const base = rawBase.replace(/\/$/, "");
const httpBase = base.replace(/^ws:/, "http:").replace(/^wss:/, "https:");
const wsBase = base.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? "8000");

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

async function checkHealth() {
  const response = await withTimeout(fetch(`${httpBase}/health`), "health check");
  if (!response.ok) {
    throw new Error(`/health returned ${response.status}`);
  }
  const body = await response.json();
  if (body?.ok !== true) {
    throw new Error(`/health returned unexpected body ${JSON.stringify(body)}`);
  }
  console.log("ok /health");
}

class SmokeSocket {
  private ws: WebSocket;
  private inbox: Json[] = [];
  private waiters: Array<{ predicate: (message: Json) => boolean; resolve: (message: Json) => void }> = [];

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as Json;
      this.inbox.push(message);
      console.log("<-", JSON.stringify(message));
      this.waiters = this.waiters.filter((waiter) => {
        if (waiter.predicate(message)) {
          waiter.resolve(message);
          return false;
        }
        return true;
      });
    });
  }

  static connect(path: "game" | "audio", guestId: string): Promise<SmokeSocket> {
    return withTimeout(
      new Promise((resolve, reject) => {
        const ws = new WebSocket(`${wsBase}/${path}?guestId=${guestId}`, { headers: { Origin: origin } });
        ws.addEventListener("open", () => resolve(new SmokeSocket(ws)));
        ws.addEventListener("error", () => reject(new Error(`${path} socket failed to open`)));
        ws.addEventListener("close", (event) => {
          if (event.code !== 1000 && event.code !== 1005) {
            reject(new Error(`${path} socket closed early: ${event.code} ${event.reason}`));
          }
        });
      }),
      `${path} socket open`,
    );
  }

  send(message: Json) {
    console.log("->", JSON.stringify(message));
    this.ws.send(JSON.stringify(message));
  }

  waitFor(type: string, label = type, occurrence = 1): Promise<Json> {
    const existing = this.inbox.filter((message) => message.type === type)[occurrence - 1];
    if (existing) {
      return Promise.resolve(existing);
    }
    return withTimeout(
      new Promise((resolve) => {
        this.waiters.push({
          predicate: (message) => message.type === type && this.inbox.filter((item) => item.type === type).length >= occurrence,
          resolve,
        });
      }),
      label,
    );
  }

  waitForAny(types: string[], label = types.join("|")): Promise<Json> {
    const existing = this.inbox.find((message) => typeof message.type === "string" && types.includes(message.type));
    if (existing) {
      return Promise.resolve(existing);
    }
    return withTimeout(
      new Promise((resolve) => {
        this.waiters.push({
          predicate: (message) => typeof message.type === "string" && types.includes(message.type),
          resolve,
        });
      }),
      label,
    );
  }

  close() {
    this.ws.close();
  }
}

function guest(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

async function checkBotGame() {
  const game = await SmokeSocket.connect("game", guest("smoke-bot"));
  game.send({
    type: "bot:start",
    mode: "easy",
    timeControl: { initialSeconds: 300, incrementSeconds: 0 },
    side: "white",
    strength: 0,
  });
  const start = await game.waitFor("game:start", "bot game:start");
  const gameId = String(start.gameId);
  await game.waitFor("game:state", "bot game:state");
  game.send({ type: "move:propose", gameId, raw: "e4" });
  await game.waitFor("move:confirmed", "player move confirmed");
  await game.waitFor("move:confirmed", "bot move confirmed", 2);
  game.send({ type: "game:resign", gameId });
  await game.waitFor("game:end", "bot game:end");
  game.close();
  console.log("ok bot game, legal move, bot fallback, resign");
}

async function checkInviteAndAudio() {
  const creatorGuest = guest("smoke-creator");
  const joinerGuest = guest("smoke-joiner");
  const creatorGame = await SmokeSocket.connect("game", creatorGuest);
  const joinerGame = await SmokeSocket.connect("game", joinerGuest);
  creatorGame.send({
    type: "invite:create",
    mode: "easy",
    timeControl: { initialSeconds: 300, incrementSeconds: 0 },
  });
  const invite = await creatorGame.waitFor("invite:created", "invite created");
  joinerGame.send({ type: "invite:join", inviteId: invite.inviteId });
  const creatorStart = await creatorGame.waitFor("game:start", "creator game:start");
  const joinerStart = await joinerGame.waitFor("game:start", "joiner game:start");
  await Promise.all([creatorGame.waitFor("game:state", "creator game:state"), joinerGame.waitFor("game:state", "joiner game:state")]);

  const gameId = String(creatorStart.gameId);
  const whiteGuest = creatorStart.color === "white" ? creatorGuest : joinerGuest;
  const whiteGame = creatorStart.color === "white" ? creatorGame : joinerGame;

  if (joinerStart.gameId !== creatorStart.gameId) {
    throw new Error("invite players received different game IDs");
  }

  const whiteAudioSocket = await SmokeSocket.connect("audio", whiteGuest);
  whiteAudioSocket.send({ type: "audio:transcript", gameId, text: "e4" });
  await whiteAudioSocket.waitFor("stt:interim", "stt interim");
  await whiteAudioSocket.waitFor("stt:final", "stt final");
  await whiteGame.waitFor("move:confirmed", "transcript move confirmed");
  whiteGame.send({ type: "game:resign", gameId });
  await whiteGame.waitFor("game:end", "invite game:end");
  whiteAudioSocket.close();
  creatorGame.close();
  joinerGame.close();
  console.log("ok invite game and dev transcript audio path");
}

async function main() {
  console.log(`smoking ${wsBase} with Origin ${origin}`);
  await checkHealth();
  await checkBotGame();
  await checkInviteAndAudio();
  console.log("smoke passed");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
