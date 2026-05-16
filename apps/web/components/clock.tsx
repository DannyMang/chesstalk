"use client";

import type { Color } from "@chesstalk/shared";

type ClockProps = {
  ms: number;
  isActive: boolean;
  color: Color;
};

function formatClock(ms: number): string {
  const safeMs = Math.max(0, ms);
  const totalSeconds = safeMs / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  if (safeMs < 20_000) {
    const tenths = Math.floor((safeMs % 1000) / 100);
    return `${mm}:${ss}.${tenths}`;
  }
  return `${mm}:${ss}`;
}

export function Clock({ ms, isActive, color }: ClockProps) {
  const label = color === "white" ? "White" : "Black";
  const containerClass = [
    "flex flex-col rounded border px-4 py-3 font-mono tabular-nums transition-colors",
    isActive
      ? "border-[#7fa650] bg-[#3c4a2e] text-[#f5f3ef] shadow-[inset_0_0_0_1px_rgba(127,166,80,0.25)]"
      : "border-[#4a4640] bg-[#312e2b] text-[#cfc8bd]",
  ].join(" ");
  return (
    <div className={containerClass}>
      <span className="text-[10px] uppercase tracking-wider opacity-70">
        {label}
      </span>
      <span className="text-2xl font-semibold">{formatClock(ms)}</span>
    </div>
  );
}
