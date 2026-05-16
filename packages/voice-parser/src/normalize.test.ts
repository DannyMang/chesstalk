import { describe, expect, test } from "bun:test";
import { normalize } from "./normalize.ts";

describe("normalize", () => {
  test("lowercases and collapses whitespace", () => {
    expect(normalize("  Knight   to   F3  ")).toBe("knight to f3");
  });

  test("rewrites 'night' to 'knight'", () => {
    expect(normalize("night to f3")).toBe("knight to f3");
  });

  test("rewrites 'naked' to 'knight'", () => {
    expect(normalize("naked takes e5")).toBe("knight takes e5");
  });

  test("rewrites 'cattle' to 'castle'", () => {
    expect(normalize("cattle kingside")).toBe("castle kingside");
  });

  test("collapses 'king side' to 'kingside'", () => {
    expect(normalize("castles king side")).toBe("castle kingside");
  });

  test("collapses 'queen side' to 'queenside'", () => {
    expect(normalize("castles queen side")).toBe("castle queenside");
  });

  test("NATO phonetic file -> letter (joined with rank into square)", () => {
    expect(normalize("alpha 4")).toBe("a4");
    expect(normalize("delta 2 to delta 4")).toBe("d2 to d4");
  });

  test("'ate' -> 8 and 'for' -> 4 (joined into square)", () => {
    expect(normalize("e for")).toBe("e4");
    expect(normalize("e ate")).toBe("e8");
  });

  test("'two' -> 2 only adjacent to file", () => {
    expect(normalize("knight to e two")).toBe("knight to e2");
    expect(normalize("I have two pawns").includes("2")).toBe(false);
  });

  test("'to' is preserved as connector, not turned into 2", () => {
    expect(normalize("knight to f3")).toBe("knight to f3");
  });

  test("drops filler words", () => {
    expect(normalize("uh um like move the knight to f3")).toBe("knight to f3");
  });

  test("'horse' -> 'knight' and 'tower' -> 'rook'", () => {
    expect(normalize("horse to f3")).toBe("knight to f3");
    expect(normalize("tower takes e5")).toBe("rook takes e5");
  });

  test("strips punctuation but preserves hyphens", () => {
    expect(normalize("O-O!")).toBe("o-o");
    expect(normalize("knight to f3, please.")).toBe("knight to f3");
  });

  test("'captures' collapses to 'takes'", () => {
    expect(normalize("queen captures e5")).toBe("queen takes e5");
  });
});
