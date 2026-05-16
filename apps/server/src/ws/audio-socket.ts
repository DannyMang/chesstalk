import type { RawData, WebSocket } from "ws";
import { parseVerbalMove } from "@chesstalk/voice-parser";
import type { ClientAudioMessage, ServerAudioMessage } from "@chesstalk/shared";
import { getDb } from "../db/client.ts";
import { dispatchMove } from "../game/dispatch.ts";
import { registry } from "../game/registry.ts";
import { ensureUserExists } from "../game/users.ts";
import { logger } from "../logger.ts";

const LOG_EVERY_N_FRAMES = 100;

function byteLength(data: RawData): number {
  if (typeof data === "string") return Buffer.byteLength(data, "utf8");
  if (Buffer.isBuffer(data)) return data.length;
  if (Array.isArray(data)) {
    let total = 0;
    for (const b of data) total += b.length;
    return total;
  }
  return data.byteLength;
}

function rawDataToString(data: RawData): string {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
}

function fallbackUsername(clerkUserId: string): string {
  if (clerkUserId.startsWith("guest:")) {
    return `guest_${clerkUserId.slice(-6)}`;
  }
  return `player_${clerkUserId.slice(-6)}`;
}

function sendJson(ws: WebSocket, msg: ServerAudioMessage): void {
  if (ws.readyState !== ws.OPEN) return;
  try {
    ws.send(JSON.stringify(msg));
  } catch (err) {
    logger.warn("audio ws send failed", { err: String(err) });
  }
}

function sendSttError(ws: WebSocket, gameId: string, message: string): void {
  sendJson(ws, { type: "stt:error", gameId, message });
}

async function handleTranscript(
  ws: WebSocket,
  internalUserId: string,
  msg: Extract<ClientAudioMessage, { type: "audio:transcript" }>,
): Promise<void> {
  const text = msg.text.trim();
  if (!text) {
    sendSttError(ws, msg.gameId, "Transcript is empty");
    return;
  }

  const game = registry.get(msg.gameId);
  if (!game) {
    sendSttError(ws, msg.gameId, `No active game ${msg.gameId}`);
    return;
  }

  const color = game.userColor(internalUserId);
  if (color === null) {
    sendSttError(ws, msg.gameId, "Not a player in this game");
    return;
  }
  if (color !== game.turn()) {
    sendSttError(ws, msg.gameId, "Not your turn");
    return;
  }

  sendJson(ws, { type: "stt:interim", gameId: msg.gameId, text });

  const parsed = parseVerbalMove(text, game.chess.fen());
  if (!parsed.ok) {
    const suffix =
      parsed.reason === "ambiguous" && parsed.candidates
        ? `: ${parsed.candidates.join(", ")}`
        : "";
    sendSttError(ws, msg.gameId, `Could not parse spoken move (${parsed.reason}${suffix})`);
    return;
  }

  sendJson(ws, { type: "stt:final", gameId: msg.gameId, text });
  const result = dispatchMove(game, internalUserId, parsed.san);
  if (!result.ok) {
    sendSttError(ws, msg.gameId, result.reason);
  }
}

export function handleAudioConnection(
  ws: WebSocket,
  clerkUserId: string,
  gameId: string | null,
): void {
  const log = logger.child({ socket: "audio", clerkUserId, gameId });
  log.info("audio socket connected");

  let frames = 0;
  let bytes = 0;
  let internalUserId: string | null = null;
  const db = getDb();

  void (async () => {
    try {
      const user = await ensureUserExists(db, clerkUserId, fallbackUsername(clerkUserId));
      internalUserId = user._id;
      log.info("audio session established", { userId: user._id, username: user.username });
    } catch (err) {
      log.error("audio ensureUserExists failed", { err: String(err) });
      const targetGameId = gameId ?? "unknown";
      sendSttError(ws, targetGameId, "Failed to load user");
      ws.close(1011, "user init failed");
    }
  })();

  ws.on("message", (data, isBinary) => {
    if (!isBinary) {
      let parsed: ClientAudioMessage;
      try {
        parsed = JSON.parse(rawDataToString(data)) as ClientAudioMessage;
      } catch (err) {
        log.warn("audio socket invalid JSON", { err: String(err) });
        sendSttError(ws, gameId ?? "unknown", "Invalid audio control message");
        return;
      }

      if (parsed.type === "audio:transcript") {
        if (!internalUserId) {
          sendSttError(ws, parsed.gameId, "Session is still initializing");
          return;
        }
        void handleTranscript(ws, internalUserId, parsed).catch((err: unknown) => {
          log.error("audio transcript handler failed", { err: String(err) });
          sendSttError(ws, parsed.gameId, "Failed to process transcript");
        });
        return;
      }

      log.info("audio control message", { type: parsed.type, size: byteLength(data) });
      return;
    }
    frames += 1;
    bytes += byteLength(data);
    if (frames % LOG_EVERY_N_FRAMES === 0) {
      log.info("audio frames received", { frames, bytes });
    }
  });

  ws.on("close", (code, reason) => {
    log.info("audio socket closed", {
      code,
      reason: reason.toString(),
      frames,
      bytes,
    });
  });

  ws.on("error", (err) => {
    log.error("audio socket error", { err: String(err) });
  });
}
