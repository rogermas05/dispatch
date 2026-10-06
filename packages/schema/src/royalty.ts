// Royalty policy from SPEC.md §9. Pure functions; the shared vectors in
// fixtures/royalty-vectors.json are the contract any other implementation must match.

export const TOTAL_BPS = 10_000;
export const CREATOR_BPS_WHEN_DERIVED = 8_000;
export const DEFAULT_PLATFORM_FEE_BPS = 500;
export const MAX_DIRECT_PARENTS = 4;

export interface SplitEntry {
  recipient_id: string;
  bps: number;
}

export interface Allocation {
  recipient_id: string;
  amount: bigint;
}

function assertValidSplit(split: readonly SplitEntry[]): void {
  const total = split.reduce((sum, entry) => sum + entry.bps, 0);
  if (total !== TOTAL_BPS || split.some((entry) => !Number.isInteger(entry.bps) || entry.bps < 0)) {
    throw new Error(`split must be nonnegative integer bps totalling ${TOTAL_BPS}, got ${total}`);
  }
}

/**
 * Freeze a new experience's recipient vector at publication.
 * Roots keep 100%. Descendants keep 80% for the creator and share 20% equally
 * across parents, each parent's share expanded through its own frozen vector.
 * Entry 0 of the result is always the creator; it also absorbs rounding residue.
 */
export function freezeSplit(creatorId: string, parentSplits: readonly (readonly SplitEntry[])[]): SplitEntry[] {
  if (parentSplits.length > MAX_DIRECT_PARENTS) {
    throw new Error(`at most four direct parents are allowed, got ${parentSplits.length}`);
  }
  if (parentSplits.length === 0) {
    return [{ recipient_id: creatorId, bps: TOTAL_BPS }];
  }
  parentSplits.forEach(assertValidSplit);

  const parentPoolBps = TOTAL_BPS - CREATOR_BPS_WHEN_DERIVED;
  const merged = new Map<string, number>([[creatorId, 0]]);
  for (const split of parentSplits) {
    for (const entry of split) {
      const share = Math.floor((parentPoolBps * entry.bps) / (TOTAL_BPS * parentSplits.length));
      merged.set(entry.recipient_id, (merged.get(entry.recipient_id) ?? 0) + share);
    }
  }

  const othersBps = [...merged].reduce((sum, [id, bps]) => (id === creatorId ? sum : sum + bps), 0);
  return [...merged]
    .map(([recipient_id, bps]) => ({ recipient_id, bps: recipient_id === creatorId ? TOTAL_BPS - othersBps : bps }))
    .filter((entry) => entry.bps > 0);
}

/**
 * Split an amount actually collected on-chain. The platform fee is floored;
 * each recipient gets floor(net * bps / 10000); residue goes to entry 0 (the creator).
 */
export function allocate(
  collected: bigint,
  split: readonly SplitEntry[],
  feeBps: number = DEFAULT_PLATFORM_FEE_BPS,
): { fee: bigint; allocations: Allocation[] } {
  if (collected < 0n) throw new Error("collected amount cannot be negative");
  assertValidSplit(split);

  const total = BigInt(TOTAL_BPS);
  const fee = (collected * BigInt(feeBps)) / total;
  const net = collected - fee;
  const floored = split.map((entry) => ({ recipient_id: entry.recipient_id, amount: (net * BigInt(entry.bps)) / total }));
  const residue = net - floored.reduce((sum, a) => sum + a.amount, 0n);

  return {
    fee,
    allocations: floored.map((a, i) => (i === 0 ? { ...a, amount: a.amount + residue } : a)),
  };
}
