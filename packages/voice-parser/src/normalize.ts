const NATO_FILES: Record<string, string> = {
  alpha: "a",
  bravo: "b",
  charlie: "c",
  delta: "d",
  echo: "e",
  foxtrot: "f",
  golf: "g",
  hotel: "h",
};

const PIECE_REWRITES: Array<[RegExp, string]> = [
  [/\bnight\b/g, "knight"],
  [/\bnite\b/g, "knight"],
  [/\bknights?\b/g, "knight"],
  [/\bnaked\b/g, "knight"],
  [/\bhorse\b/g, "knight"],
  [/\bhorsey\b/g, "knight"],
  [/\bbishops\b/g, "bishop"],
  [/\brooks\b/g, "rook"],
  [/\btower\b/g, "rook"],
  [/\bqueens\b/g, "queen"],
  [/\bkings\b/g, "king"],
  [/\bpawns\b/g, "pawn"],
];

// Castle vocabulary is normalized to the words "castle" / "kingside" /
// "queenside" only. Conversion to the actual SAN ("O-O") is left to parse.ts,
// so normalize stays free of move-resolution concerns.
const CASTLE_REWRITES: Array<[RegExp, string]> = [
  [/\bcattle\b/g, "castle"],
  [/\bcastles\b/g, "castle"],
  [/\bcastling\b/g, "castle"],
  [/\bking[\s-]?side\b/g, "kingside"],
  [/\bqueen[\s-]?side\b/g, "queenside"],
];

const VERB_REWRITES: Array<[RegExp, string]> = [
  [/\bcaptures?\b/g, "takes"],
  [/\btake\b/g, "takes"],
  [/\bpromotes?\s+to\b/g, "promote"],
  [/\bpromoting\s+to\b/g, "promote"],
  [/\bpromotion\b/g, "promote"],
  [/\ben\s+passant\b/g, "enpassant"],
];

// Digit homophones run first so that letter homophones below ("be 4", "see 8")
// can see them after they've been spelled as digits.
const DIGIT_HOMOPHONE_REWRITES: Array<[RegExp, string]> = [
  [/\bate\b/g, "8"],
  [/\bfor\b/g, "4"],
];

// "be" -> "b" only when followed by a rank digit or a spelled rank word; same
// for "see"/"gee". "two" is intentionally NOT a regex rewrite because
// "to"/"too" are the natural move connectors and we don't want to misfire on
// those — "two" is handled below in replaceNumberWords with adjacency context.
const RANK_LOOKAHEAD = "(?=(?:[1-8]|one|two|three|four|five|six|seven|eight)\\b)";
const LETTER_HOMOPHONE_REWRITES: Array<[RegExp, string]> = [
  [new RegExp(`\\bbe\\s+${RANK_LOOKAHEAD}`, "g"), "b "],
  [new RegExp(`\\bsee\\s+${RANK_LOOKAHEAD}`, "g"), "c "],
  [new RegExp(`\\bgee\\s+${RANK_LOOKAHEAD}`, "g"), "g "],
];

const NUMBER_WORDS: Record<string, string> = {
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
};

// "a" and "i" intentionally NOT fillers: "a" is a file letter; "i" rarely
// appears in chess speech but if someone says "I resign" / "I castle" we'd
// rather keep the word out by letting it be parsed as nothing meaningful.
const FILLERS = new Set([
  "uh",
  "um",
  "uhm",
  "like",
  "okay",
  "ok",
  "please",
  "the",
  "go",
  "move",
  "my",
  "an",
  "just",
  "well",
]);

const LEADING_PRONOUN_RE = /^i\s+/;

function replaceNumberWords(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === undefined) continue;
    const digit = NUMBER_WORDS[tok];
    if (digit === undefined) {
      out.push(tok);
      continue;
    }
    const prev = i > 0 ? tokens[i - 1] : undefined;
    const next = i + 1 < tokens.length ? tokens[i + 1] : undefined;
    const adjacentFile =
      (prev !== undefined && /^[a-h]$/.test(prev)) ||
      (next !== undefined && /^[a-h]$/.test(next));
    if (adjacentFile) {
      out.push(digit);
    } else {
      out.push(tok);
    }
  }
  return out;
}

function replaceNatoFiles(tokens: string[]): string[] {
  return tokens.map((t) => NATO_FILES[t] ?? t);
}

function dropFillers(tokens: string[]): string[] {
  return tokens.filter((t) => !FILLERS.has(t));
}

// After NATO + number-word replacement we may have "e 4" where the player
// meant the single square "e4". Join any [a-h] immediately followed by [1-8]
// so the downstream parser sees coordinate tokens.
function joinSquares(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const cur = tokens[i];
    const next = i + 1 < tokens.length ? tokens[i + 1] : undefined;
    if (cur !== undefined && next !== undefined && /^[a-h]$/.test(cur) && /^[1-8]$/.test(next)) {
      out.push(cur + next);
      i++;
    } else if (cur !== undefined) {
      out.push(cur);
    }
  }
  return out;
}

export function normalize(text: string): string {
  let s = text.toLowerCase();
  s = s.replace(/[.,!?;:"]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(LEADING_PRONOUN_RE, "");

  for (const [re, rep] of PIECE_REWRITES) s = s.replace(re, rep);
  for (const [re, rep] of CASTLE_REWRITES) s = s.replace(re, rep);
  for (const [re, rep] of VERB_REWRITES) s = s.replace(re, rep);
  for (const [re, rep] of DIGIT_HOMOPHONE_REWRITES) s = s.replace(re, rep);
  for (const [re, rep] of LETTER_HOMOPHONE_REWRITES) s = s.replace(re, rep);

  let tokens = s.split(/\s+/).filter(Boolean);
  tokens = replaceNatoFiles(tokens);
  tokens = replaceNumberWords(tokens);
  tokens = dropFillers(tokens);
  tokens = joinSquares(tokens);

  return tokens.join(" ").trim();
}
