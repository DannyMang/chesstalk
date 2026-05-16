"use client";

import type { MoveRecord } from "@chesstalk/shared";

type MoveListProps = {
  moves: MoveRecord[];
};

type Pair = { number: number; white: MoveRecord; black: MoveRecord | null };

function pairMoves(moves: MoveRecord[]): Pair[] {
  const pairs: Pair[] = [];
  for (let i = 0; i < moves.length; i += 2) {
    const white = moves[i];
    if (!white) continue;
    const black = moves[i + 1] ?? null;
    pairs.push({ number: i / 2 + 1, white, black });
  }
  return pairs;
}

export function MoveList({ moves }: MoveListProps) {
  if (moves.length === 0) {
    return (
      <p className="text-sm text-neutral-500">No moves yet.</p>
    );
  }
  const pairs = pairMoves(moves);
  const lastIdx = moves.length - 1;
  return (
    <ol className="grid grid-cols-[2rem_1fr_1fr] gap-x-2 gap-y-1 font-mono text-sm">
      {pairs.map((pair) => {
        const whiteIdx = (pair.number - 1) * 2;
        const blackIdx = whiteIdx + 1;
        return (
          <li key={pair.number} className="contents">
            <span className="text-neutral-400">{pair.number}.</span>
            <span
              className={
                whiteIdx === lastIdx
                  ? "rounded bg-emerald-100 px-1 font-semibold text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200"
                  : ""
              }
            >
              {pair.white.san}
            </span>
            <span
              className={
                pair.black && blackIdx === lastIdx
                  ? "rounded bg-emerald-100 px-1 font-semibold text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200"
                  : ""
              }
            >
              {pair.black?.san ?? ""}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
