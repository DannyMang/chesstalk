"use client";

import { useMemo } from "react";
import { Chessboard } from "react-chessboard";
import type { MoveRecord } from "@chesstalk/shared";

type GameBoardProps = {
  fen: string;
  boardOrientation: "white" | "black";
  lastMove: MoveRecord | null;
};

const HIGHLIGHT_STYLE = { background: "rgba(46, 125, 50, 0.35)" };

function uciSquares(uci: string): [string, string] | null {
  if (uci.length < 4) return null;
  return [uci.slice(0, 2), uci.slice(2, 4)];
}

export function GameBoard({ fen, boardOrientation, lastMove }: GameBoardProps) {
  const squareStyles = useMemo<Record<string, React.CSSProperties>>(() => {
    if (!lastMove) return {};
    const squares = uciSquares(lastMove.uci);
    if (!squares) return {};
    const [from, to] = squares;
    return { [from]: HIGHLIGHT_STYLE, [to]: HIGHLIGHT_STYLE };
  }, [lastMove]);

  return (
    <Chessboard
      options={{
        position: fen,
        boardOrientation,
        allowDragging: false,
        allowDrawingArrows: false,
        showAnimations: true,
        animationDurationInMs: 200,
        squareStyles,
      }}
    />
  );
}
