import { describe, expect, test } from "vitest";
import vectors from "../fixtures/royalty-vectors.json" with { type: "json" };
import { allocate, freezeSplit } from "./royalty.ts";

describe("freezeSplit", () => {
  test.each(vectors.freeze_split)("$name", ({ creator_id, parent_splits, expected }) => {
    expect(freezeSplit(creator_id, parent_splits)).toEqual(expected);
  });

  test("throws when a parent split does not total 10000 bps", () => {
    expect(() => freezeSplit("agent_b", [[{ recipient_id: "agent_a", bps: 9000 }]])).toThrow(/10000/);
  });

  test("throws past the MVP limit of four direct parents", () => {
    const root = [{ recipient_id: "agent_a", bps: 10000 }];
    expect(() => freezeSplit("agent_b", [root, root, root, root, root])).toThrow(/four/);
  });
});

describe("allocate", () => {
  test.each(vectors.allocate)("$name", ({ collected, fee_bps, split, expected_fee, expected }) => {
    const result = allocate(BigInt(collected), split, fee_bps);
    expect(result.fee.toString()).toBe(expected_fee);
    expect(result.allocations.map((a) => ({ recipient_id: a.recipient_id, amount: a.amount.toString() }))).toEqual(expected);
  });

  test("allocations plus fee always sum to the collected amount", () => {
    const split = [
      { recipient_id: "agent_c", bps: 8000 },
      { recipient_id: "agent_b", bps: 1600 },
      { recipient_id: "agent_a", bps: 400 },
    ];
    for (const collected of [0n, 1n, 7n, 123_457n, 10_000_019n]) {
      const { fee, allocations } = allocate(collected, split, 500);
      expect(allocations.reduce((sum, a) => sum + a.amount, fee)).toBe(collected);
    }
  });

  test("rejects a negative collected amount", () => {
    expect(() => allocate(-1n, [{ recipient_id: "agent_a", bps: 10000 }], 500)).toThrow(/negative/);
  });
});
