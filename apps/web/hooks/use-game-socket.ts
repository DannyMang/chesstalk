"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import type { ClientGameMessage, ServerGameMessage } from "@chesstalk/shared";
import {
  connectGameSocket,
  type GameSocket,
  type GameSocketHandler,
  type GameSocketStatus,
} from "../lib/game-socket.ts";
import { getOrCreateGuestId } from "../lib/guest.ts";

const DEFAULT_URL = "ws://localhost:8787/game";

function resolveUrl(): string {
  const base = process.env.NEXT_PUBLIC_GAME_SERVER_URL ?? DEFAULT_URL;
  if (base.endsWith("/game")) return base;
  return `${base.replace(/\/$/, "")}/game`;
}

export interface UseGameSocketResult {
  status: GameSocketStatus;
  send: (msg: ClientGameMessage) => void;
  subscribe: (handler: GameSocketHandler) => () => void;
}

export function useGameSocket(): UseGameSocketResult {
  const { getToken, isLoaded } = useAuth();
  const socketRef = useRef<GameSocket | null>(null);
  const handlersRef = useRef<Set<GameSocketHandler>>(new Set());
  const [status, setStatus] = useState<GameSocketStatus>("connecting");

  useEffect(() => {
    if (!isLoaded) return;
    const url = resolveUrl();
    const fanout: GameSocketHandler = (msg: ServerGameMessage) => {
      for (const h of handlersRef.current) h(msg);
    };
    const socket = connectGameSocket({
      url,
      getToken: () => getToken(),
      getGuestId: getOrCreateGuestId,
      onStatusChange: setStatus,
      reconnectWindowMs: 10_000,
    });
    socket.on(fanout);
    socketRef.current = socket;
    return () => {
      socket.off(fanout);
      socket.close();
      socketRef.current = null;
    };
  }, [getToken, isLoaded]);

  const send = useCallback((msg: ClientGameMessage): void => {
    socketRef.current?.send(msg);
  }, []);

  const subscribe = useCallback((handler: GameSocketHandler): (() => void) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  return { status, send, subscribe };
}
