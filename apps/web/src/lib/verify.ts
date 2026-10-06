import { canonicalize, type CallOutcome } from "@token-origins/schema";

export interface CommitmentCheck {
  computed: string;
  matches: boolean;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Recomputes a Masumi input/output hash in the browser, exactly as the agent API commits it. */
export async function verifyCommitment(value: unknown, expected: string): Promise<CommitmentCheck> {
  const computed = await sha256Hex(canonicalize(value));
  return { computed, matches: computed === expected };
}

/** Changes one digit in the last thing the other party said, e.g. a reference number. */
export function tamper(result: CallOutcome): CallOutcome {
  const copy = structuredClone(result);
  const turn = copy.transcript.turns.findLast((t) => t.speaker === "other" && /\d/.test(t.text));
  if (turn) turn.text = turn.text.replace(/\d/, (d) => String((Number(d) + 1) % 10));
  return copy;
}
