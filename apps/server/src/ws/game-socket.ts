import { Color, type Mode } from "@chesstalk/shared/enums";
import type {
  ClientGameMessage,
  OpponentInfo,
  ServerGameMessage,
} from "@chesstalk/shared/wire";
import type { Db } from "mongodb";
import type { RawData, WebSocket } from "ws";
import { getDb } from "../db/client.ts";
import { dispatchMove } from "../game/dispatch.ts";
import { GameActor } from "../game/game-actor.ts";
import { inviteRegistry } from "../game/invites.ts";
import { matchmaker } from "../game/matchmaker.ts";
import {
  persistFinishedGame,
  updateRatingsOnFinish,
  type RatingUpdateResult,
} from "../game/persistence.ts";
import { registry } from "../game/registry.ts";
import { stockfish } from "../game/stockfish.ts";
import { ensureUserExists, getRatingFor } from "../game/users.ts";
import { logger } from "../logger.ts";

function rawDataToString(data: RawData): string {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
}

const HEARTBEAT_INTERVAL_MS = 30_000;
const BOT_USER_ID = "bot:stockfish";
const BOT_USERNAME = "Stockfish";

const botStrengthByGame = new Map<string, number>();

interface AliveSocket extends WebSocket {
  isAlive: boolean;
}

interface Session {
  userId: string; // internal user _id, not Clerk id
  clerkUserId: string;
  username: string;
  ws: WebSocket;
}

interface StartedSide {
  ws: WebSocket;
  color: Color;
  opponent: OpponentInfo;
}

function sendJson(ws: WebSocket, msg: ServerGameMessage): void {
  if (ws.readyState !== ws.OPEN) return;
  try {
    ws.send(JSON.stringify(msg));
  } catch (err) {
    logger.warn("ws send failed", { err: String(err) });
  }
}

function sendError(ws: WebSocket, code: string, message: string): void {
  sendJson(ws, { type: "error", code, message });
}

function fallbackUsername(clerkUserId: string): string {
  if (clerkUserId.startsWith("guest:")) {
    return `guest_${clerkUserId.slice(-6)}`;
  }
  // Stable, harmless default until the user picks one in their profile.
  return `player_${clerkUserId.slice(-6)}`;
}

async function wireUpFinishedGame(
  game: GameActor,
  db: Db,
): Promise<RatingUpdateResult | null> {
  try {
    const ratings = await updateRatingsOnFinish(game, db);
    await persistFinishedGame(game, db);
    registry.unregister(game.id);
    return ratings;
  } catch (err) {
    logger.error("finalize game failed", { gameId: game.id, err: String(err) });
    registry.unregister(game.id);
    return null;
  }
}

function broadcastGameEnd(game: GameActor, ratings: RatingUpdateResult | null): void {
  if (game.result === null || game.termination === null) return;
  const whiteDelta = ratings ? ratings.whiteAfter - ratings.whiteBefore : 0;
  const blackDelta = ratings ? ratings.blackAfter - ratings.blackBefore : 0;
  game.sendTo(Color.White, {
    type: "game:end",
    gameId: game.id,
    result: game.result,
    termination: game.termination,
    ratingDeltaSelf: whiteDelta,
    ratingDeltaOpponent: blackDelta,
  });
  game.sendTo(Color.Black, {
    type: "game:end",
    gameId: game.id,
    result: game.result,
    termination: game.termination,
    ratingDeltaSelf: blackDelta,
    ratingDeltaOpponent: whiteDelta,
  });
}

async function finalizeAndBroadcast(game: GameActor, db: Db): Promise<void> {
  const ratings = await wireUpFinishedGame(game, db);
  botStrengthByGame.delete(game.id);
  broadcastGameEnd(game, ratings);
}

function broadcastInitialState(game: GameActor): void {
  const now = Date.now();
  const clocks = game.clockSnapshot(now);
  const msg: ServerGameMessage = {
    type: "game:state",
    gameId: game.id,
    fen: game.chess.fen(),
    turn: game.turn(),
    whiteClockMs: clocks.whiteClockMs,
    blackClockMs: clocks.blackClockMs,
    lastMove: null,
  };
  game.broadcast(msg);
}

function startGame(
  game: GameActor,
  self: StartedSide,
  other: StartedSide,
  db: Db,
): void {
  game.attachConnection(self.color, self.ws);
  game.attachConnection(other.color, other.ws);
  // Anchor lastMoveAt to now so white's clock starts ticking at game:start.
  game.lastMoveAt = Date.now();
  registry.register(game);

  game.onEnd((g) => finalizeAndBroadcast(g, db));

  sendJson(self.ws, {
    type: "game:start",
    gameId: game.id,
    color: self.color,
    opponent: self.opponent,
    mode: game.mode,
    timeControl: game.timeControl,
  });
  sendJson(other.ws, {
    type: "game:start",
    gameId: game.id,
    color: other.color,
    opponent: other.opponent,
    mode: game.mode,
    timeControl: game.timeControl,
  });

  broadcastInitialState(game);
}

function scheduleBotMove(game: GameActor): void {
  if (game.status !== "active") return;
  if (game.userColor(BOT_USER_ID) !== game.turn()) return;

  setTimeout(() => {
    void (async () => {
      if (game.status !== "active") return;
      if (game.userColor(BOT_USER_ID) !== game.turn()) return;

      try {
        const uci = await stockfish.bestMove(game.chess.fen(), {
          movetimeMs: 150,
          strength: botStrengthByGame.get(game.id) ?? 5,
        });
        if (!uci || uci === "(none)") return;
        const from = uci.slice(0, 2);
        const to = uci.slice(2, 4);
        const promotion = uci.slice(4, 5);
        const move = promotion ? `${from}${to}${promotion}` : `${from}${to}`;
        dispatchMove(game, BOT_USER_ID, move);
      } catch (err) {
        logger.error("stockfish bot move failed", {
          gameId: game.id,
          err: String(err),
        });
      }
    })();
  }, 250);
}

async function sessionOpponentInfo(session: Session, mode: Mode, db: Db): Promise<OpponentInfo> {
  const rating = await getRatingFor(db, session.userId, mode);
  return {
    userId: session.userId,
    username: session.username,
    rating,
  };
}

async function handleQueueJoin(
  session: Session,
  msg: Extract<ClientGameMessage, { type: "queue:join" }>,
  db: Db,
): Promise<void> {
  const opponentInfo = await sessionOpponentInfo(session, msg.mode, db);

  const result = matchmaker.enqueue(
    session.userId,
    session.ws,
    msg.mode,
    msg.timeControl,
    opponentInfo,
  );

  if (!result.matched) {
    sendJson(session.ws, {
      type: "queue:waiting",
      mode: msg.mode,
      timeControl: msg.timeControl,
      queueDepth: 1,
    });
    return;
  }

  const { game, self, other } = result;
  startGame(game, self, other, db);
}

async function handleInviteCreate(
  session: Session,
  msg: Extract<ClientGameMessage, { type: "invite:create" }>,
  db: Db,
): Promise<void> {
  matchmaker.leave(session.userId);
  const opponentInfo = await sessionOpponentInfo(session, msg.mode, db);
  const inviteId = inviteRegistry.create(
    session.userId,
    session.ws,
    msg.mode,
    msg.timeControl,
    opponentInfo,
  );

  sendJson(session.ws, {
    type: "invite:created",
    inviteId,
    mode: msg.mode,
    timeControl: msg.timeControl,
  });
}

async function handleInviteJoin(
  session: Session,
  msg: Extract<ClientGameMessage, { type: "invite:join" }>,
  db: Db,
): Promise<void> {
  const inviter = inviteRegistry.peek(msg.inviteId);
  if (!inviter) {
    sendError(session.ws, "invite_not_found", `No pending invite ${msg.inviteId}`);
    return;
  }

  if (inviter.userId === session.userId) {
    sendError(session.ws, "invite_self_join", "You cannot join your own invite");
    return;
  }

  matchmaker.leave(session.userId);
  const opponentInfo = await sessionOpponentInfo(session, inviter.mode, db);
  const result = inviteRegistry.join(msg.inviteId, session.userId, session.ws, opponentInfo);

  if (!result.matched) {
    const message =
      result.reason === "self_join"
        ? "You cannot join your own invite"
        : `No pending invite ${msg.inviteId}`;
    sendError(session.ws, result.reason === "self_join" ? "invite_self_join" : "invite_not_found", message);
    return;
  }

  const { game, self, other } = result;
  startGame(game, self, other, db);
}

async function handleBotStart(
  session: Session,
  msg: Extract<ClientGameMessage, { type: "bot:start" }>,
  db: Db,
): Promise<void> {
  matchmaker.leave(session.userId);
  inviteRegistry.leaveByUser(session.userId);

  const playerInfo = await sessionOpponentInfo(session, msg.mode, db);
  const playerColor = msg.side ?? Color.White;
  const botColor = playerColor === Color.White ? Color.Black : Color.White;
  const now = Date.now();
  const playerSnapshot = {
    userId: playerInfo.userId,
    username: playerInfo.username,
    ratingBefore: playerInfo.rating,
    ratingAfter: null,
  };
  const strength = Math.max(0, Math.min(20, Math.round(msg.strength ?? 5)));
  const botSnapshot = {
    userId: BOT_USER_ID,
    username: `${BOT_USERNAME} Lv ${strength}`,
    ratingBefore: 800 + strength * 70,
    ratingAfter: null,
  };

  const game = new GameActor({
    id: crypto.randomUUID(),
    mode: msg.mode,
    timeControl: msg.timeControl,
    white: playerColor === Color.White ? playerSnapshot : botSnapshot,
    black: playerColor === Color.Black ? playerSnapshot : botSnapshot,
    now,
  });

  game.attachConnection(playerColor, session.ws);
  game.lastMoveAt = Date.now();
  registry.register(game);
  botStrengthByGame.set(game.id, strength);
  game.onEnd((g) => finalizeAndBroadcast(g, db));
  game.onMove((g) => scheduleBotMove(g));

  sendJson(session.ws, {
    type: "game:start",
    gameId: game.id,
    color: playerColor,
    opponent: {
      userId: BOT_USER_ID,
      username: botSnapshot.username,
      rating: botSnapshot.ratingBefore,
    },
    mode: game.mode,
    timeControl: game.timeControl,
  });

  broadcastInitialState(game);
  if (botColor === Color.White) scheduleBotMove(game);
}

function handleMovePropose(
  session: Session,
  msg: Extract<ClientGameMessage, { type: "move:propose" }>,
): void {
  const game = registry.get(msg.gameId);
  if (!game) {
    sendError(session.ws, "game_not_found", `No active game ${msg.gameId}`);
    return;
  }
  dispatchMove(game, session.userId, msg.raw);
}

function handleResign(
  session: Session,
  msg: Extract<ClientGameMessage, { type: "game:resign" }>,
): void {
  const game = registry.get(msg.gameId);
  if (!game) {
    sendError(session.ws, "game_not_found", `No active game ${msg.gameId}`);
    return;
  }
  game.resign(session.userId);
}

function handleOfferDraw(
  session: Session,
  msg: Extract<ClientGameMessage, { type: "game:offerDraw" }>,
): void {
  const game = registry.get(msg.gameId);
  if (!game) {
    sendError(session.ws, "game_not_found", `No active game ${msg.gameId}`);
    return;
  }
  game.offerDraw(session.userId);
}

function handleAcceptDraw(
  session: Session,
  msg: Extract<ClientGameMessage, { type: "game:acceptDraw" }>,
): void {
  const game = registry.get(msg.gameId);
  if (!game) {
    sendError(session.ws, "game_not_found", `No active game ${msg.gameId}`);
    return;
  }
  game.acceptDraw(session.userId);
}

export function handleGameConnection(ws: WebSocket, clerkUserId: string): void {
  const log = logger.child({ socket: "game", clerkUserId });
  const alive = ws as AliveSocket;
  alive.isAlive = true;

  log.info("game socket connected");

  let session: Session | null = null;
  const db = getDb();

  void (async () => {
    try {
      const user = await ensureUserExists(db, clerkUserId, fallbackUsername(clerkUserId));
      session = { userId: user._id, clerkUserId, username: user.username, ws };
      log.info("game session established", { userId: user._id, username: user.username });
    } catch (err) {
      log.error("ensureUserExists failed", { err: String(err) });
      sendError(ws, "user_init_failed", "Failed to load user");
      ws.close(1011, "user init failed");
    }
  })();

  const heartbeat = setInterval(() => {
    if (!alive.isAlive) {
      log.warn("game socket heartbeat timeout; terminating");
      ws.terminate();
      return;
    }
    alive.isAlive = false;
    ws.ping();
  }, HEARTBEAT_INTERVAL_MS);

  ws.on("pong", () => {
    alive.isAlive = true;
  });

  ws.on("message", (data, isBinary) => {
    if (isBinary) {
      log.warn("game socket received unexpected binary frame");
      return;
    }
    let parsed: ClientGameMessage;
    try {
      parsed = JSON.parse(rawDataToString(data)) as ClientGameMessage;
    } catch (err) {
      log.warn("game socket invalid JSON", { err: String(err) });
      return;
    }

    if (parsed.type === "ping") {
      sendJson(ws, { type: "pong", t: parsed.t, serverNow: Date.now() });
      return;
    }

    if (!session) {
      sendError(ws, "session_not_ready", "Session is still initializing");
      return;
    }
    const s = session;

    void (async () => {
      try {
        switch (parsed.type) {
          case "queue:join":
            await handleQueueJoin(s, parsed, db);
            break;
          case "bot:start":
            await handleBotStart(s, parsed, db);
            break;
          case "queue:leave":
            matchmaker.leave(s.userId);
            break;
          case "invite:create":
            await handleInviteCreate(s, parsed, db);
            break;
          case "invite:join":
            await handleInviteJoin(s, parsed, db);
            break;
          case "move:propose":
            handleMovePropose(s, parsed);
            break;
          case "game:resign":
            handleResign(s, parsed);
            break;
          case "game:offerDraw":
            handleOfferDraw(s, parsed);
            break;
          case "game:acceptDraw":
            handleAcceptDraw(s, parsed);
            break;
          default: {
            const _exhaustive: never = parsed;
            void _exhaustive;
          }
        }
      } catch (err) {
        log.error("game message handler failed", {
          type: parsed.type,
          err: String(err),
        });
        sendError(ws, "handler_error", "Failed to process message");
      }
    })();
  });

  ws.on("close", (code, reason) => {
    clearInterval(heartbeat);
    if (session) {
      matchmaker.leave(session.userId);
      inviteRegistry.leaveByUser(session.userId);
      // Detach this ws from any games it was attached to. The game itself
      // stays alive; M2 has no reconnect logic yet — the opponent will see
      // the clock keep ticking until time runs out.
      for (const game of registry.all()) {
        const color = game.userColor(session.userId);
        if (color !== null) game.detachConnection(color, ws);
      }
    }
    log.info("game socket closed", { code, reason: reason.toString() });
  });

  ws.on("error", (err) => {
    log.error("game socket error", { err: String(err) });
  });
}
