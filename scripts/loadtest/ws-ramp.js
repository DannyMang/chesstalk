// k6 WebSocket load test for the ChessTalk Go server.
//
// Usage:
//   WS_URL=wss://your-server/game GUEST_PREFIX=load \
//     k6 run scripts/loadtest/ws-ramp.js
//
// Ramps 0 -> 1000 concurrent WS connections over 5 minutes, holds for 5,
// then drains. Each virtual user joins matchmaking, plays a fixed sequence
// of moves on a 5s interval, and disconnects after ~60s of session time.
//
// Set GUEST_PREFIX so each VU registers as a unique guest user.

import ws from "k6/ws";
import { check } from "k6";

export const options = {
  stages: [
    { duration: "2m", target: 500 },
    { duration: "3m", target: 1000 },
    { duration: "5m", target: 1000 },
    { duration: "1m", target: 0 },
  ],
  thresholds: {
    ws_connecting: ["p(95)<2000"],
    ws_session_duration: ["p(95)<70000"],
  },
};

const WS_URL = __ENV.WS_URL || "ws://localhost:8787/game";
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

  const res = ws.connect(url, {}, (socket) => {
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
