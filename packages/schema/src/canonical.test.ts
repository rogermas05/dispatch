import { describe, expect, test } from "vitest";
import { canonicalize as agentApiCanonicalize } from "../../../apps/agent-api/src/hash.ts";
import { canonicalize } from "./canonical.ts";

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
