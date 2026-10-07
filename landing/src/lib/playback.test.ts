import { describe, expect, test } from "vitest";
import { turnIndexAt, turnSpans } from "./playback";

const turns = [{ at: 0 }, { at: 7 }, { at: 9 }];

describe("turnIndexAt", () => {
  test("returns -1 before the first turn starts", () => {
    expect(turnIndexAt([{ at: 2 }], 1)).toBe(-1);
  });

  test("returns the turn in progress", () => {
    expect(turnIndexAt(turns, 0)).toBe(0);
    expect(turnIndexAt(turns, 6.9)).toBe(0);
    expect(turnIndexAt(turns, 7)).toBe(1);
    expect(turnIndexAt(turns, 30)).toBe(2);
  });
});

describe("turnSpans", () => {
  test("each turn runs until the next, and the last runs to the end", () => {
    expect(turnSpans(turns, 10)).toEqual([
      { start: 0, width: 0.7 },
      { start: 0.7, width: 0.2 },
      { start: 0.9, width: expect.closeTo(0.1) },
    ]);
  });

  test("spans cover the whole timeline", () => {
    const total = turnSpans(turns, 10).reduce((sum, span) => sum + span.width, 0);
    expect(total).toBeCloseTo(1);
  });
});
