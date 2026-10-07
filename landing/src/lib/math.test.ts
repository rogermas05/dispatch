import { describe, expect, test } from "vitest";
import { clamp, formatClock, segmentAt, shortHash, smoothstep } from "./math";

describe("formatClock", () => {
  test("pads minutes and seconds", () => {
    expect(formatClock(7)).toBe("00:07");
    expect(formatClock(58)).toBe("00:58");
    expect(formatClock(125)).toBe("02:05");
  });

  test("adds hours once an hour has passed", () => {
    expect(formatClock(6432)).toBe("01:47:12");
  });

  test("never shows negative time", () => {
    expect(formatClock(-4)).toBe("00:00");
  });
});

describe("segmentAt", () => {
  const stops = [100, 300, 700];

  test("clamps before the first stop", () => {
    expect(segmentAt(stops, 0)).toEqual({ index: 0, t: 0 });
  });

  test("returns eased progress between two stops", () => {
    expect(segmentAt(stops, 200)).toEqual({ index: 0, t: 0.5 });
    expect(segmentAt(stops, 400).index).toBe(1);
    expect(segmentAt(stops, 400).t).toBeCloseTo(smoothstep(0.25));
  });

  test("clamps at the last stop", () => {
    expect(segmentAt(stops, 5000)).toEqual({ index: 2, t: 0 });
  });

  test("handles a single stop", () => {
    expect(segmentAt([50], 999)).toEqual({ index: 0, t: 0 });
  });
});

test("clamp keeps values inside the range", () => {
  expect(clamp(-1)).toBe(0);
  expect(clamp(2)).toBe(1);
  expect(clamp(5, 0, 10)).toBe(5);
});

test("shortHash keeps both ends of a long hash", () => {
  expect(shortHash("ad8dd99a5bc00ae6633254e953e632f34b0a45e31a6ac68a16463ee88b8adda7")).toBe("ad8dd99a…8adda7");
  expect(shortHash("abc")).toBe("abc");
});
