"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Chess } from "chess.js";
import type { GameDoc, Mode, MoveRecord } from "@chesstalk/shared";
import { GameBoard } from "../../../components/game-board.tsx";
import { MoveList } from "../../../components/move-list.tsx";

interface ReplayProps {
  gameId: string;
  moves: MoveRecord[];
  yourColor: "white" | "black";
  opponentUsername: string;
  mode: Mode;
  result: GameDoc["result"];
}

const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function formatClock(ms: number): string {
  const safe = Math.max(0, ms);
  const totalSeconds = Math.floor(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function Replay(props: ReplayProps) {
  const [currentMoveIdx, setCurrentMoveIdx] = useState<number>(-1);
  const [showRaw, setShowRaw] = useState(false);

  const fen = useMemo(() => {
    if (currentMoveIdx < 0) return STARTING_FEN;
    const chess = new Chess();
    for (let i = 0; i <= currentMoveIdx; i++) {
      const move = props.moves[i];
      if (!move) break;
      const applied = chess.move(move.san);
      if (!applied) break;
    }
    return chess.fen();
  }, [currentMoveIdx, props.moves]);

  const lastMove = currentMoveIdx >= 0 ? props.moves[currentMoveIdx] ?? null : null;
  const visibleMoves = props.moves.slice(0, Math.max(0, currentMoveIdx + 1));

  const goFirst = (): void => setCurrentMoveIdx(-1);
  const goPrev = (): void =>
    setCurrentMoveIdx((idx) => Math.max(-1, idx - 1));
  const goNext = (): void =>
    setCurrentMoveIdx((idx) => Math.min(props.moves.length - 1, idx + 1));
  const goLast = (): void => setCurrentMoveIdx(props.moves.length - 1);

  const orientation: "white" | "black" = props.yourColor;

  return (
    <section className="flex flex-col gap-6 py-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">
            Replay vs {props.opponentUsername}
          </h1>
          <p className="text-xs uppercase tracking-wider text-neutral-500">
            {props.mode === "easy" ? "Easy" : "Blindfold"} · You are{" "}
            {props.yourColor}
            {props.result ? ` · Result: ${props.result}` : ""}
          </p>
        </div>
        <Link
          href="/history"
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          Back to history
        </Link>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-4">
          <div className="aspect-square w-full overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
            <GameBoard
              fen={fen}
              boardOrientation={orientation}
              lastMove={lastMove}
            />
          </div>
          <div className="flex items-center justify-center gap-2">
            <NavButton onClick={goFirst} disabled={currentMoveIdx === -1}>
              «
            </NavButton>
            <NavButton onClick={goPrev} disabled={currentMoveIdx === -1}>
              ‹ Prev
            </NavButton>
            <span className="font-mono text-sm text-neutral-500">
              {currentMoveIdx + 1} / {props.moves.length}
            </span>
            <NavButton
              onClick={goNext}
              disabled={currentMoveIdx >= props.moves.length - 1}
            >
              Next ›
            </NavButton>
            <NavButton
              onClick={goLast}
              disabled={currentMoveIdx >= props.moves.length - 1}
            >
              »
            </NavButton>
          </div>
        </div>

        <aside className="flex flex-col gap-4 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-medium uppercase tracking-wider text-neutral-500">
              Moves
            </h2>
            <label className="flex items-center gap-2 text-xs text-neutral-500">
              <input
                type="checkbox"
                checked={showRaw}
                onChange={(e) => setShowRaw(e.target.checked)}
              />
              Show what I said
            </label>
          </div>
          <div className="max-h-[50vh] overflow-y-auto">
            <MoveList moves={visibleMoves} />
          </div>
          {lastMove ? (
            <div className="rounded border border-neutral-200 p-3 text-xs dark:border-neutral-800">
              <div className="flex justify-between">
                <span className="text-neutral-500">White clock</span>
                <span className="font-mono">
                  {formatClock(lastMove.whiteClockMs)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">Black clock</span>
                <span className="font-mono">
                  {formatClock(lastMove.blackClockMs)}
                </span>
              </div>
              {showRaw && lastMove.raw ? (
                <div className="mt-2 border-t border-neutral-200 pt-2 dark:border-neutral-800">
                  <span className="text-neutral-500">Said:</span>{" "}
                  <span className="italic">&quot;{lastMove.raw}&quot;</span>
                </div>
              ) : null}
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

function NavButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-900"
    >
      {children}
    </button>
  );
}
