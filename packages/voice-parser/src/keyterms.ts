import { Chess, type PieceSymbol, type Move } from "chess.js";

const PIECE_NAMES: Record<PieceSymbol, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

const NATO_FILES = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"];
const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const RANK_WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight"];

const COMMON_VOCAB = [
  "knight",
  "bishop",
  "rook",
  "queen",
  "king",
  "pawn",
  "takes",
  "captures",
  "castles",
  "kingside",
  "queenside",
  "check",
  "checkmate",
  "mate",
  "en passant",
  "promotes",
  "promotion",
  "draw",
  "resign",
];

function verbalForms(m: Move): string[] {
  const out: string[] = [];
  const pieceName = PIECE_NAMES[m.piece];
  if (m.isKingsideCastle()) {
    out.push("castles kingside", "castle kingside", "short castle");
    return out;
  }
  if (m.isQueensideCastle()) {
    out.push("castles queenside", "castle queenside", "long castle");
    return out;
  }
  const verb = m.isCapture() ? "takes" : "to";
  out.push(`${pieceName} ${verb} ${m.to}`);
  if (m.isCapture()) {
    out.push(`${pieceName} captures ${m.to}`);
  }
  if (m.piece === "p" && m.isCapture()) {
    out.push(`${m.from[0]} takes ${m.to}`);
  }
  if (m.promotion) {
    const promoName = PIECE_NAMES[m.promotion];
    out.push(`${pieceName} promotes to ${promoName}`);
    out.push(`${pieceName} to ${m.to} ${promoName}`);
    out.push(`promote to ${promoName}`);
  }
  if (m.isEnPassant()) {
    out.push(`${pieceName} takes ${m.to} en passant`);
  }
  return out;
}

export function buildKeyterms(fen: string): string[] {
  const chess = new Chess(fen);
  const verbose = chess.moves({ verbose: true });
  const sans = chess.moves();

  const terms = new Set<string>();

  for (const san of sans) terms.add(san);
  for (const m of verbose) {
    for (const form of verbalForms(m)) terms.add(form);
  }
  for (const n of NATO_FILES) terms.add(n);
  for (const f of FILES) terms.add(f);
  for (const r of RANK_WORDS) terms.add(r);
  for (const w of COMMON_VOCAB) terms.add(w);

  return Array.from(terms);
}
