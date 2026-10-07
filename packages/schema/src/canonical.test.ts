import { describe, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { canonicalize as agentApiCanonicalize, masumiInputHash, masumiOutputHash } from "../../../apps/agent-api/src/hash.ts";
import { canonicalize, commitmentPreimage } from "./canonical.ts";

// The dashboard recomputes on-chain hashes in the browser. If its canonical form
// ever drifts from the agent API's, every proof shown to a judge would fail.
const samples: unknown[] = [
  null,
  "plain",
  42,
  [3, { b: 1, a: [true, null] }],
  { to: "+15550100", objective: "x", authorization: "y", context: { z: "1", a: "2" }, max_duration_seconds: 900 },
  { nested: { deeper: { keys: ["é", "\n", "\"quoted\""] } }, empty: {}, list: [] },
  { dropped: undefined, kept: 0 },
];

describe("canonicalize", () => {
  test.each(samples.map((s) => [JSON.stringify(s) ?? "undefined", s]))("matches the agent API for %s", (_, sample) => {
    expect(canonicalize(sample)).toBe(agentApiCanonicalize(sample));
  });

  test("sorts keys so property order never changes the hash input", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
});

describe("commitmentPreimage", () => {
  const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
  const nonce = "c0ffee00c0ffee";
  const input = { to: "+15550100187", objective: "Ask about SH-7731", authorization: "Nothing" };
  const result = { status: "completed", summary: "ok", artifacts: { Ticket: "BL-30982" } };

  test("with a nonce, reproduces the agent API's MIP-004 input hash", () => {
    expect(sha(commitmentPreimage(input, nonce))).toBe(masumiInputHash(input, nonce));
  });

  test("with a nonce, reproduces the MIP-004 output hash of the stored canonical result", () => {
    expect(sha(commitmentPreimage(result, nonce))).toBe(masumiOutputHash(agentApiCanonicalize(result), nonce));
  });

  test("without a nonce, is the plain canonical JSON", () => {
    expect(commitmentPreimage(input, null)).toBe(canonicalize(input));
  });
});
