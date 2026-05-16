export function remainingMs(clockMs: number, lastMoveAt: number, now: number): number {
  return Math.max(0, clockMs - (now - lastMoveAt));
}
