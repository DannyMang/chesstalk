"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import type { ClientAudioMessage, ServerAudioMessage } from "@chesstalk/shared";
import {
  connectAudioSocket,
  type AudioSocket,
  type AudioSocketHandler,
  type AudioSocketStatus,
} from "../lib/audio-socket.ts";
import { getOrCreateGuestId } from "../lib/guest.ts";

const DEFAULT_URL = "ws://localhost:8787/audio";

function resolveUrl(): string {
  const base = process.env.NEXT_PUBLIC_GAME_SERVER_URL;
  if (!base) return DEFAULT_URL;
  if (base.endsWith("/audio")) return base;
  const stripped = base.replace(/\/(game|audio)\/?$/, "").replace(/\/$/, "");
  return `${stripped}/audio`;
}

export interface UseAudioSocketOptions {
  gameId: string | null;
  onMessage?: (msg: ServerAudioMessage) => void;
}

export interface UseAudioSocketResult {
  status: AudioSocketStatus | "uninitialized";
  send: (msg: ClientAudioMessage) => void;
  sendBinary: (chunk: ArrayBuffer | ArrayBufferView | Blob) => void;
}

export function useAudioSocket(opts: UseAudioSocketOptions): UseAudioSocketResult {
  const { gameId, onMessage } = opts;
  const { getToken, isLoaded } = useAuth();
  const socketRef = useRef<AudioSocket | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const [status, setStatus] = useState<AudioSocketStatus | "uninitialized">(
    "uninitialized",
  );

  useEffect(() => {
    if (!isLoaded || !gameId) {
      setStatus("uninitialized");
      return;
    }
    const url = resolveUrl();
    setStatus("connecting");
    const fanout: AudioSocketHandler = (msg) => {
      onMessageRef.current?.(msg);
    };
    const socket = connectAudioSocket({
      url,
      gameId,
      getToken: () => getToken(),
      getGuestId: getOrCreateGuestId,
      onStatusChange: setStatus,
    });
    socket.on(fanout);
    socketRef.current = socket;
    return () => {
      socket.off(fanout);
      socket.close();
      socketRef.current = null;
    };
  }, [getToken, isLoaded, gameId]);

  const send = useCallback((msg: ClientAudioMessage): void => {
    socketRef.current?.sendControl(msg);
  }, []);

  const sendBinary = useCallback(
    (chunk: ArrayBuffer | ArrayBufferView | Blob): void => {
      socketRef.current?.sendBinary(chunk);
    },
    [],
  );

  return { status, send, sendBinary };
}
