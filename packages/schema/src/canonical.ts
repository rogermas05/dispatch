// Canonical JSON for Masumi input/output hashes: sorted keys, undefined dropped.
// Must stay byte-identical to apps/agent-api/src/hash.ts; canonical.test.ts enforces it.

/**
 * The exact string a commitment hash is taken over. With a purchaser nonce this
 * is the MIP-004 pre-image "<nonce>;<canonical JSON>"; without one (Coworker
 * tasks), the canonical JSON alone. The agent API stores results as canonical
 * JSON, so the same rule covers both input and output hashes.
 */
export function commitmentPreimage(value: unknown, identifierFromPurchaser: string | null): string {
  const canonical = canonicalize(value);
  return identifierFromPurchaser ? `${identifierFromPurchaser};${canonical}` : canonical;
}

export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
}
