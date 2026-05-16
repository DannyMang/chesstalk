import { describe, expect, test } from "bun:test";
import { Chess } from "chess.js";
import { parseVerbalMove } from "./parse.ts";

const START = new Chess().fen();

function fen(setup: (c: Chess) => void): string {
  const c = new Chess();
  setup(c);
  return c.fen();
}

describe("parseVerbalMove", () => {
  test("coordinate notation 'e2 to e4'", () => {
    const r = parseVerbalMove("e2 to e4", START);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.san).toBe("e4");
      expect(r.uci).toBe("e2e4");
    }
  });

  test("coordinate notation NATO 'echo 2 to echo 4'", () => {
    const r = parseVerbalMove("echo 2 to echo 4", START);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.san).toBe("e4");
  });

  test("coordinate with 'be four'", () => {
    const r = parseVerbalMove("b2 to be four", START);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.san).toBe("b4");
  });

  test("'e2 e4' bare squares", () => {
    const r = parseVerbalMove("e2 e4", START);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.san).toBe("e4");
  });

  test("piece to square 'knight to f3'", () => {
    const r = parseVerbalMove("knight to f3", START);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.san).toBe("Nf3");
  });

  test("'night to f3' (STT misrecognition)", () => {
    const r = parseVerbalMove("night to f3", START);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.san).toBe("Nf3");
  });

  test("'horse to f3' informal piece name", () => {
    const r = parseVerbalMove("horse to f3", START);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.san).toBe("Nf3");
  });

  test("direct SAN 'Nf3'", () => {
    const r = parseVerbalMove("Nf3", START);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.san).toBe("Nf3");
  });

  test("direct SAN 'e4'", () => {
    const r = parseVerbalMove("e4", START);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.san).toBe("e4");
  });

  test("piece takes square 'queen takes e5'", () => {
    const position = fen((c) => {
      c.load("rnbqkbnr/pppp1ppp/8/4p3/3P4/8/PPP1PPPP/RNBQKBNR w KQkq - 0 2");
    });
    const after = new Chess(position);
    after.move("dxe5");
    const r = parseVerbalMove("queen takes pawn", position);
    expect(r.ok).toBe(false);
  });

  test("piece-takes-square works when capture is legal", () => {
    const position = "rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";
    const r = parseVerbalMove("pawn takes d5", position);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.san).toBe("exd5");
  });

  test("castles kingside", () => {
    const position = "r1bqk2r/ppppbppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1";
    const r = parseVerbalMove("castles kingside", position);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.san).toBe("O-O");
  });

  test("short castle", () => {
    const position = "r1bqk2r/ppppbppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1";
    const r = parseVerbalMove("short castle", position);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.san).toBe("O-O");
  });

  test("castles queenside", () => {
    const position = "r3kbnr/pppqpppp/2np4/8/3PP1b1/2N1BN2/PPPQ1PPP/R3KB1R w KQkq - 4 6";
    const r = parseVerbalMove("castles queenside", position);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.san).toBe("O-O-O");
  });

  test("long castle", () => {
    const position = "r3kbnr/pppqpppp/2np4/8/3PP1b1/2N1BN2/PPPQ1PPP/R3KB1R w KQkq - 4 6";
    const r = parseVerbalMove("long castle", position);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.san).toBe("O-O-O");
  });

  test("promotion 'pawn to e8 queen'", () => {
    const position = "8/4P3/8/8/8/8/8/k6K w - - 0 1";
    const r = parseVerbalMove("pawn to e8 queen", position);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.san.startsWith("e8=Q")).toBe(true);
      expect(r.uci).toBe("e7e8q");
    }
  });

  test("promotion 'promote to knight'", () => {
    const position = "8/4P3/8/8/8/8/8/k6K w - - 0 1";
    const r = parseVerbalMove("e7 to e8 promote to knight", position);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.san.startsWith("e8=N")).toBe(true);
      expect(r.uci).toBe("e7e8n");
    }
  });

  test("ambiguous: two knights to same square", () => {
    const position = "4k3/8/8/8/3N1N2/8/8/4K3 w - - 0 1";
    const r = parseVerbalMove("knight to e6", position);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("ambiguous");
      expect(r.candidates).toBeDefined();
      expect(r.candidates && r.candidates.length).toBe(2);
    }
  });

  test("illegal coordinate move", () => {
    const r = parseVerbalMove("e2 to e5", START);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("illegal");
  });

  test("illegal piece-to-square (no such legal move)", () => {
    const r = parseVerbalMove("knight to e5", START);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("illegal");
  });

  test("unparseable empty input", () => {
    const r = parseVerbalMove("", START);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unparseable");
  });

  test("unparseable gibberish", () => {
    const r = parseVerbalMove("the weather is nice today", START);
    expect(r.ok).toBe(false);
  });

  test("alpha-delta NATO speak 'alpha 2 to alpha 4'", () => {
    const r = parseVerbalMove("alpha 2 to alpha 4", START);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.san).toBe("a4");
  });

  test("'knight to f three' with rank word", () => {
    const r = parseVerbalMove("knight to f three", START);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.san).toBe("Nf3");
  });

  test("bishop takes (capture phrase) when legal", () => {
    const position = "rnbqkbnr/ppp2ppp/8/3pp3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3";
    const r = parseVerbalMove("knight takes e5", position);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.san).toBe("Nxe5");
  });

  test("does not mutate input fen", () => {
    const before = START;
    parseVerbalMove("e2 to e4", before);
    expect(before).toBe(START);
  });
});
