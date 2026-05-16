import type { ClientGameMessage, ServerGameMessage } from "@chesstalk/shared";

export type GameSocketStatus = "connecting" | "open" | "closed";

export type GameSocketHandler = (msg: ServerGameMessage) => void;

export interface GameSocket {
  send(msg: ClientGameMessage): void;
  close(): void;
  on(handler: GameSocketHandler): void;
  off(handler: GameSocketHandler): void;
  status(): GameSocketStatus;
}

export interface ConnectGameSocketOptions {
  url: string;
  getToken: () => Promise<string | null>;
  getGuestId: () => string;
  onStatusChange?: (status: GameSocketStatus) => void;
  reconnectWindowMs?: number;
}

export function connectGameSocket(opts: ConnectGameSocketOptions): GameSocket {
  const handlers = new Set<GameSocketHandler>();
  let ws: WebSocket | null = null;
  let status: GameSocketStatus = "connecting";
  let closed = false;
  let reconnectAttempt = 0;
  let firstDisconnectAt: number | null = null;
  let reconnectTimer: number | null = null;
  const sendQueue: string[] = [];
  const reconnectWindowMs = opts.reconnectWindowMs ?? 10_000;

  const setStatus = (next: GameSocketStatus): void => {
    if (status === next) return;
    status = next;
    opts.onStatusChange?.(next);
  };

  const flushQueue = (): void => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    while (sendQueue.length > 0) {
      const payload = sendQueue.shift();
      if (payload !== undefined) ws.send(payload);
    }
  };

  const scheduleReconnect = (): void => {
    if (closed) return;
    const disconnectedAt = firstDisconnectAt ?? Date.now();
    firstDisconnectAt = disconnectedAt;
    const elapsed = Date.now() - disconnectedAt;
    if (elapsed >= reconnectWindowMs) {
      sendQueue.length = 0;
      setStatus("closed");
      return;
    }
    const baseDelay = Math.min(500 * 2 ** reconnectAttempt, 2_000);
    const jitteredDelay = baseDelay * (0.5 + Math.random() * 0.5);
    const remaining = reconnectWindowMs - elapsed;
    const delay = Math.max(100, Math.min(jitteredDelay, remaining));
    reconnectAttempt += 1;
    setStatus("connecting");
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      void openSocket();
    }, delay);
  };

  const openSocket = async (): Promise<void> => {
    let token: string | null = null;
    try {
      token = await opts.getToken();
    } catch {
      token = null;
    }
    if (closed) return;
    const sep = opts.url.includes("?") ? "&" : "?";
    const params = new URLSearchParams();
    if (token) params.set("token", token);
    else params.set("guestId", opts.getGuestId());
    const fullUrl = `${opts.url}${sep}${params.toString()}`;
    const socket = new WebSocket(fullUrl);
    ws = socket;

    socket.addEventListener("open", () => {
      reconnectAttempt = 0;
      firstDisconnectAt = null;
      setStatus("open");
      flushQueue();
    });

    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      let parsed: ServerGameMessage;
      try {
        parsed = JSON.parse(event.data) as ServerGameMessage;
      } catch {
        return;
      }
      for (const handler of handlers) handler(parsed);
    });

    socket.addEventListener("close", () => {
      if (ws === socket) ws = null;
      if (closed) {
        setStatus("closed");
        return;
      }
      scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      // Allow the close event to mark the socket as closed.
    });
  };

  void openSocket();

  return {
    send(msg) {
      if (status === "closed") return;
      const payload = JSON.stringify(msg);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      } else {
        sendQueue.push(payload);
      }
    },
    close() {
      closed = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close();
      }
      setStatus("closed");
    },
    on(handler) {
      handlers.add(handler);
    },
    off(handler) {
      handlers.delete(handler);
    },
    status() {
      return status;
    },
  };
}
