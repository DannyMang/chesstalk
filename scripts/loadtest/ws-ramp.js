// k6 WebSocket load test for the ChessTalk Go server.
//
// Usage:
//   WS_URL=wss://your-server/game MAX_VUS=1000 \
//     k6 run scripts/loadtest/ws-ramp.js
//
// Ramps 0 -> MAX_VUS concurrent WS connections (default 1000). Each virtual
// user joins matchmaking, plays a fixed sequence of moves on a 5s interval,
// and disconnects after ~60s. Total run time is ~11 minutes.
//
// Env vars:
//   WS_URL       — wss:// or ws:// URL to the /game endpoint (required)
//   ORIGIN       — Origin header to send; must match ALLOWED_ORIGINS on the
//                  server. Defaults to http://localhost:3000.
//   MAX_VUS      — peak concurrent connections (default 1000)
//   GUEST_PREFIX — unique per-run prefix so guest IDs don't collide

import ws from "k6/ws";
import { check } from "k6";

const MAX_VUS = parseInt(__ENV.MAX_VUS || "1000", 10);
const ORIGIN = __ENV.ORIGIN || "http://localhost:3000";

function gameUrl(base) {
  if (!base) return "ws://localhost:8787/game";
  if (base.endsWith("/game")) return base;
  return base.replace(/\/$/, "") + "/game";
}

export const options = {
  stages: [
    { duration: "2m", target: Math.floor(MAX_VUS / 2) },
    { duration: "3m", target: MAX_VUS },
    { duration: "5m", target: MAX_VUS },
    { duration: "1m", target: 0 },
  ],
  thresholds: {
    ws_connecting: ["p(95)<2000"],
    ws_session_duration: ["p(95)<70000"],
  },
};

const WS_URL = gameUrl(__ENV.WS_URL);
const GUEST_PREFIX = __ENV.GUEST_PREFIX || "loadtest";

// Two minimally legal openings; we alternate VUs across them so paired
// games don't both try to play the same color's first move.
const SCRIPTS = [
  ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6", "e1g1"],
  ["d2d4", "d7d5", "c2c4", "e7e6", "b1c3", "g8f6", "g1f3"],
];

export default function () {
  const guestId = `${GUEST_PREFIX}-${__VU}-${__ITER}`;
  const sep = WS_URL.includes("?") ? "&" : "?";
  const url = `${WS_URL}${sep}guestId=${guestId}`;
  const script = SCRIPTS[__VU % SCRIPTS.length];

  const res = ws.connect(
    url,
    { headers: { Origin: ORIGIN }, tags: { name: "ws-game" } },
    (socket) => {
    let gameId = null;
    let moveIdx = 0;
    let myColor = null;

    socket.on("open", () => {
      socket.send(
        JSON.stringify({
          type: "queue:join",
          mode: "easy",
          timeControl: { initialSeconds: 300, incrementSeconds: 0 },
        }),
      );
    });

    socket.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (msg.type === "game:start") {
        gameId = msg.gameId;
        myColor = msg.color;
      }
      if (msg.type === "move:confirmed" && gameId && myColor) {
        const isMyTurn = msg.turn === myColor;
        if (isMyTurn && moveIdx < script.length) {
          socket.setTimeout(() => {
            socket.send(
              JSON.stringify({
                type: "move:propose",
                gameId,
                raw: script[moveIdx++],
              }),
            );
          }, 1000);
        }
      }
    });

    socket.setTimeout(() => {
      if (gameId) socket.send(JSON.stringify({ type: "game:resign", gameId }));
      socket.close();
    }, 60_000);

    socket.setInterval(() => {
      if (!gameId || !myColor) return;
      if (moveIdx >= script.length) return;
      socket.send(
        JSON.stringify({
          type: "move:propose",
          gameId,
          raw: script[moveIdx++],
        }),
      );
    }, 5000);
  });

  check(res, { "ws status is 101": (r) => r && r.status === 101 });
}
