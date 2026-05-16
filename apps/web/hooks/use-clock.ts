"use client";

import { useEffect, useRef, useState } from "react";
import type { Color } from "@chesstalk/shared";

export interface ClockSnapshot {
  whiteMs: number;
  blackMs: number;
  turn: Color;
  asOf: number;
}

export interface DisplayedClocks {
  whiteMs: number;
  blackMs: number;
}

const TICK_MS = 100;

export function useClock(snapshot: ClockSnapshot | null): DisplayedClocks {
  const snapshotRef = useRef<ClockSnapshot | null>(snapshot);
  const [display, setDisplay] = useState<DisplayedClocks>(() => ({
    whiteMs: snapshot?.whiteMs ?? 0,
    blackMs: snapshot?.blackMs ?? 0,
  }));

  useEffect(() => {
    snapshotRef.current = snapshot;
    if (!snapshot) {
      setDisplay({ whiteMs: 0, blackMs: 0 });
      return;
    }
    setDisplay({ whiteMs: snapshot.whiteMs, blackMs: snapshot.blackMs });
  }, [snapshot]);

  useEffect(() => {
    if (!snapshot) return;
    const id = window.setInterval(() => {
      const snap = snapshotRef.current;
      if (!snap) return;
      const elapsed = Date.now() - snap.asOf;
      const whiteMs = snap.turn === "white" ? snap.whiteMs - elapsed : snap.whiteMs;
      const blackMs = snap.turn === "black" ? snap.blackMs - elapsed : snap.blackMs;
      setDisplay({
        whiteMs: Math.max(0, whiteMs),
        blackMs: Math.max(0, blackMs),
      });
    }, TICK_MS);
    return () => {
      window.clearInterval(id);
    };
  }, [snapshot]);

  return display;
}
