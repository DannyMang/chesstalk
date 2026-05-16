import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import type { FastifyInstance } from "fastify";
import { WebSocketServer } from "ws";
import { verifyClerkSessionToken } from "../auth/clerk.ts";
import { env } from "../env.ts";
import { logger } from "../logger.ts";
import { handleAudioConnection } from "./audio-socket.ts";
import { handleGameConnection } from "./game-socket.ts";

const allowedOrigins = new Set<string>(env.ALLOWED_ORIGINS);

function originAllowed(origin: string | undefined): boolean {
  if (!origin) return false;
  return allowedOrigins.has(origin);
}

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  const body = `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`;
  try {
    socket.write(body);
  } finally {
    socket.destroy();
  }
}

function extractTokenFromUrl(
  rawUrl: string | undefined,
): { path: string; token: string; guestId: string | null; gameId: string | null } | null {
  if (!rawUrl) return null;
  const url = new URL(rawUrl, "http://internal.local");
  const token = url.searchParams.get("token") ?? "";
  const guestId = url.searchParams.get("guestId");
  const gameId = url.searchParams.get("gameId");
  return { path: url.pathname, token, guestId, gameId };
}

function sanitizeGuestId(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(trimmed)) return null;
  return `guest:${trimmed}`;
}

export interface AttachedWsServers {
  game: WebSocketServer;
  audio: WebSocketServer;
  closeAll: () => Promise<void>;
}

export function attachWebSocketServers(fastify: FastifyInstance): AttachedWsServers {
  const httpServer: HttpServer = fastify.server;
  const gameWss = new WebSocketServer({ noServer: true });
  const audioWss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const origin = req.headers.origin;
    if (!originAllowed(origin)) {
      logger.warn("ws upgrade rejected: bad origin", { origin });
      rejectUpgrade(socket, 403, "Forbidden");
      return;
    }

    const parsed = extractTokenFromUrl(req.url);
    if (!parsed) {
      rejectUpgrade(socket, 400, "Bad Request");
      return;
    }

    const { path, token, guestId, gameId } = parsed;
    if (path !== "/game" && path !== "/audio") {
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }

    const guestUserId = sanitizeGuestId(guestId);
    if (!token && guestUserId) {
      if (path === "/game") {
        gameWss.handleUpgrade(req, socket, head, (ws) => {
          handleGameConnection(ws, guestUserId);
        });
      } else {
        audioWss.handleUpgrade(req, socket, head, (ws) => {
          handleAudioConnection(ws, guestUserId, gameId);
        });
      }
      return;
    }

    verifyClerkSessionToken(token)
      .then((session) => {
        if (!session) {
          logger.warn("ws upgrade rejected: invalid token", { path });
          const wss = path === "/game" ? gameWss : audioWss;
          wss.handleUpgrade(req, socket, head, (ws) => {
            ws.close(4401, "Unauthorized");
          });
          return;
        }
        if (path === "/game") {
          gameWss.handleUpgrade(req, socket, head, (ws) => {
            handleGameConnection(ws, session.userId);
          });
        } else {
          audioWss.handleUpgrade(req, socket, head, (ws) => {
            handleAudioConnection(ws, session.userId, gameId);
          });
        }
      })
      .catch((err: unknown) => {
        logger.error("ws upgrade failed", { err: String(err) });
        rejectUpgrade(socket, 500, "Internal Server Error");
      });
  });

  async function closeAll(): Promise<void> {
    for (const client of gameWss.clients) client.terminate();
    for (const client of audioWss.clients) client.terminate();
    await Promise.all([
      new Promise<void>((resolve) => gameWss.close(() => resolve())),
      new Promise<void>((resolve) => audioWss.close(() => resolve())),
    ]);
  }

  return { game: gameWss, audio: audioWss, closeAll };
}
