import type { ClientAudioMessage, ServerAudioMessage } from "@chesstalk/shared";

export type AudioSocketStatus = "connecting" | "open" | "closed";

export type AudioSocketHandler = (msg: ServerAudioMessage) => void;

export interface AudioSocket {
  sendBinary(chunk: ArrayBuffer | ArrayBufferView | Blob): void;
  sendControl(msg: ClientAudioMessage): void;
  close(): void;
  on(handler: AudioSocketHandler): void;
  off(handler: AudioSocketHandler): void;
  status(): AudioSocketStatus;
}

export interface ConnectAudioSocketOptions {
  url: string;
  gameId: string;
  getToken: () => Promise<string | null>;
  getGuestId: () => string;
  onStatusChange?: (status: AudioSocketStatus) => void;
}

type BinaryPayload = ArrayBuffer | ArrayBufferView | Blob;

export function connectAudioSocket(opts: ConnectAudioSocketOptions): AudioSocket {
  const handlers = new Set<AudioSocketHandler>();
  let ws: WebSocket | null = null;
  let status: AudioSocketStatus = "connecting";
  let closed = false;
  const controlQueue: string[] = [];
  // WHY: binary frames are dropped if the socket isn't open yet — audio is
  // realtime and queueing stale chunks would just delay the live stream.
  // Control messages (start/stop) are tiny + meaningful, so we queue those.

  const setStatus = (next: AudioSocketStatus): void => {
    if (status === next) return;
    status = next;
    opts.onStatusChange?.(next);
  };

  const flushControl = (): void => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    while (controlQueue.length > 0) {
      const payload = controlQueue.shift();
      if (payload !== undefined) ws.send(payload);
    }
  };

  void (async () => {
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
    params.set("gameId", opts.gameId);
    const fullUrl = `${opts.url}${sep}${params.toString()}`;
    const socket = new WebSocket(fullUrl);
    socket.binaryType = "arraybuffer";
    ws = socket;

    socket.addEventListener("open", () => {
      setStatus("open");
      flushControl();
    });

    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      let parsed: ServerAudioMessage;
      try {
        parsed = JSON.parse(event.data) as ServerAudioMessage;
      } catch {
        return;
      }
      for (const handler of handlers) handler(parsed);
    });

    socket.addEventListener("close", () => {
      setStatus("closed");
    });

    socket.addEventListener("error", () => {
      // Let the close event flip status.
    });
  })();

  const sendBinary = (chunk: BinaryPayload): void => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (chunk instanceof Blob) {
      ws.send(chunk);
      return;
    }
    if (chunk instanceof ArrayBuffer) {
      ws.send(chunk);
      return;
    }
    ws.send(chunk);
  };

  const sendControl = (msg: ClientAudioMessage): void => {
    const payload = JSON.stringify(msg);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    } else {
      controlQueue.push(payload);
    }
  };

  return {
    sendBinary,
    sendControl,
    close() {
      closed = true;
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
