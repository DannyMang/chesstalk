import { Chess, type PieceSymbol, type Square, type Move } from "chess.js";
import { normalize } from "./normalize.ts";

export type ParseResult =
  | { ok: true; san: string; uci: string }
  | {
      ok: false;
      reason: "unparseable" | "illegal" | "ambiguous";
      candidates?: string[];
    };

const PIECE_WORDS: Record<string, PieceSymbol> = {
  knight: "n",
  bishop: "b",
  rook: "r",
  queen: "q",
  king: "k",
  pawn: "p",
};

const PIECE_LETTERS: Record<PieceSymbol, string> = {
  n: "N",
  b: "B",
  r: "R",
  q: "Q",
  k: "K",
  p: "",
};

const PROMOTE_WORDS: Record<string, PieceSymbol> = {
  queen: "q",
  rook: "r",
  bishop: "b",
  knight: "n",
};

const SQUARE_RE = /\b([a-h])\s*([1-8])\b/g;
const SAN_LIKE_RE = /^[NBRQK]?[a-h]?[1-8]?x?[a-h][1-8](=[NBRQ])?[+#]?$|^O-O(-O)?[+#]?$/i;

function canonicalizeSan(compact: string): string {
  // Castling forms: normalize "o-o" -> "O-O", "0-0" -> "O-O".
  if (/^[o0]-[o0](-[o0])?[+#]?$/i.test(compact)) {
    return compact.replace(/[o0]/gi, "O");
  }
  // Piece-letter prefix: "nf3" -> "Nf3"; promotion piece: "e8=q" -> "e8=Q".
  let out = compact;
  if (/^[nbrqk]/i.test(out)) out = out[0]!.toUpperCase() + out.slice(1);
  out = out.replace(/=([nbrq])/i, (_m, p1: string) => `=${p1.toUpperCase()}`);
  return out;
}

function toUci(m: Move): string {
  return `${m.from}${m.to}${m.promotion ?? ""}`;
}

function ok(m: Move): ParseResult {
  return { ok: true, san: m.san, uci: toUci(m) };
}

function tryMove(
  chess: Chess,
  move: string | { from: string; to: string; promotion?: string },
): Move | null {
  try {
    return chess.move(move, { strict: false });
  } catch {
    return null;
  }
}

function extractSquares(s: string): Square[] {
  const out: Square[] = [];
  for (const m of s.matchAll(SQUARE_RE)) {
    out.push(`${m[1]}${m[2]}` as Square);
  }
  return out;
}

function findPieceWord(tokens: string[]): PieceSymbol | null {
  for (const t of tokens) {
    const p = PIECE_WORDS[t];
    if (p) return p;
  }
  return null;
}

// Promotion is only inferred when the user said "promote" explicitly OR when a
// piece word follows a destination square on rank 1/8 (e.g. "pawn to e8 queen").
// We deliberately do NOT treat the leading piece word as a promotion target,
// otherwise "knight to f3" would be read as "promote to knight".
function findPromotion(tokens: string[]): PieceSymbol | null {
  const promoteIdx = tokens.findIndex((t) => t === "promote");
  if (promoteIdx >= 0) {
    for (let i = promoteIdx + 1; i < tokens.length; i++) {
      const tok = tokens[i];
      if (tok === undefined) continue;
      const p = PROMOTE_WORDS[tok];
      if (p) return p;
    }
  }
  for (let i = 0; i < tokens.length - 1; i++) {
    const cur = tokens[i];
    const next = tokens[i + 1];
    if (cur === undefined || next === undefined) continue;
    if (/^[a-h][18]$/.test(cur)) {
      const p = PROMOTE_WORDS[next];
      if (p) return p;
    }
  }
  return null;
}

function tryCastling(chess: Chess, normalized: string): ParseResult | null {
  const hasCastleWord = /\bcastle\b/.test(normalized) || /\bO-O(-O)?\b/.test(normalized);
  if (!hasCastleWord) return null;
  const isLong =
    /\bqueenside\b/.test(normalized) ||
    /\blong\b/.test(normalized) ||
    /\bO-O-O\b/.test(normalized);
  const target = isLong ? "O-O-O" : "O-O";
  const m = tryMove(new Chess(chess.fen()), target);
  if (m) return ok(m);
  if (!isLong) {
    const alt = tryMove(new Chess(chess.fen()), "O-O-O");
    if (alt) return ok(alt);
  }
  return { ok: false, reason: "illegal" };
}

function tryDirectSan(chess: Chess, normalized: string): ParseResult | null {
  const compact = normalized.replace(/\s+/g, "");
  if (!compact) return null;
  if (!SAN_LIKE_RE.test(compact)) return null;
  const san = canonicalizeSan(compact);
  const m = tryMove(new Chess(chess.fen()), san);
  if (m) return ok(m);
  return null;
}

function tryCoordinate(
  chess: Chess,
  squares: Square[],
  promotion: PieceSymbol | null,
): ParseResult | null {
  if (squares.length < 2) return null;
  const from = squares[0];
  const to = squares[1];
  if (from === undefined || to === undefined) return null;
  const arg: { from: string; to: string; promotion?: string } = { from, to };
  if (promotion) arg.promotion = promotion;
  const m = tryMove(new Chess(chess.fen()), arg);
  if (m) return ok(m);
  return { ok: false, reason: "illegal" };
}

function tryPieceToSquare(
  chess: Chess,
  piece: PieceSymbol,
  to: Square,
  isCapture: boolean,
  promotion: PieceSymbol | null,
): ParseResult | null {
  const legal = new Chess(chess.fen()).moves({ verbose: true });
  const matches = legal.filter((m) => {
    if (m.piece !== piece) return false;
    if (m.to !== to) return false;
    if (isCapture && !m.isCapture()) return false;
    if (promotion && m.promotion !== promotion) return false;
    return true;
  });
  if (matches.length === 0) return { ok: false, reason: "illegal" };
  if (matches.length > 1) {
    return {
      ok: false,
      reason: "ambiguous",
      candidates: matches.map((m) => m.san),
    };
  }
  const first = matches[0];
  if (!first) return null;
  const applied = tryMove(new Chess(chess.fen()), {
    from: first.from,
    to: first.to,
    ...(first.promotion ? { promotion: first.promotion } : {}),
  });
  if (!applied) return { ok: false, reason: "illegal" };
  return ok(applied);
}

function trySanWithPieceLetter(
  chess: Chess,
  piece: PieceSymbol,
  to: Square,
  isCapture: boolean,
  promotion: PieceSymbol | null,
): ParseResult | null {
  // Try forms like "Nf3", "Nxe5", "e4", "exd5", "e8=Q" so chess.js disambiguation
  // does the work when "piece to square" enumeration is also ambiguous.
  const letter = PIECE_LETTERS[piece];
  const sep = isCapture ? "x" : "";
  const promo = promotion ? `=${PIECE_LETTERS[promotion]}` : "";
  const candidate = `${letter}${sep}${to}${promo}`;
  const m = tryMove(new Chess(chess.fen()), candidate);
  if (m) return ok(m);
  return null;
}

export function parseVerbalMove(text: string, fen: string): ParseResult {
  const chess = new Chess(fen);
  const normalized = normalize(text);
  if (!normalized) return { ok: false, reason: "unparseable" };

  const tokens = normalized.split(/\s+/).filter(Boolean);
  const squares = extractSquares(normalized);
  const piece = findPieceWord(tokens);
  const promotion = findPromotion(tokens);
  const isCapture = tokens.includes("takes");

  const castle = tryCastling(chess, normalized);
  if (castle && castle.ok) return castle;

  const direct = tryDirectSan(chess, normalized);
  if (direct && direct.ok) return direct;

  if (squares.length >= 2) {
    const coord = tryCoordinate(chess, squares, promotion);
    if (coord && coord.ok) return coord;
  }

  if (piece && squares.length >= 1) {
    const to = squares[squares.length - 1];
    if (to !== undefined) {
      const sanAttempt = trySanWithPieceLetter(chess, piece, to, isCapture, promotion);
      if (sanAttempt && sanAttempt.ok) return sanAttempt;
      const pts = tryPieceToSquare(chess, piece, to, isCapture, promotion);
      if (pts) return pts;
    }
  }

  // Pawn-only destination: "to e4" / "e4" already handled by tryDirectSan;
  // pawn capture "takes e5" with no piece word becomes a piece-to-square
  // search where piece=pawn.
  if (!piece && squares.length === 1 && isCapture) {
    const to = squares[0];
    if (to !== undefined) {
      const pts = tryPieceToSquare(chess, "p", to, true, promotion);
      if (pts) return pts;
    }
  }

  if (castle && !castle.ok) return castle;
  if (squares.length >= 1 || piece) return { ok: false, reason: "illegal" };
  return { ok: false, reason: "unparseable" };
}
