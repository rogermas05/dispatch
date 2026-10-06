import { describe, expect, test } from "vitest";
import { compact, formatAsset, percentChange, shortHash } from "./format.ts";

describe("format helpers", () => {
  test("formatAsset renders integer units with the asset's decimals", () => {
    expect(formatAsset(1_140_000n, 6)).toBe("1.14");
    expect(formatAsset(5n, 6)).toBe("0.000005");
    expect(formatAsset(0n, 6)).toBe("0.00");
  });

  test("shortHash keeps both ends", () => {
    expect(shortHash("a".repeat(30) + "b".repeat(34))).toBe("aaaaaa…bbbbbb");
  });

  test("compact abbreviates large numbers", () => {
    expect(compact(48_200)).toBe("48.2K");
    expect(compact(17)).toBe("17");
  });

  test("percentChange is signed and rounded", () => {
    expect(percentChange(17, 6)).toBe(-65);
    expect(percentChange(0, 6)).toBeNull();
  });
});
