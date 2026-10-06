const MIN_FRACTION_DIGITS = 2;

/** Integer asset units → decimal string, trimming trailing zeros past two places. */
export function formatAsset(units: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = units / scale;
  const fraction = (units % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}.${fraction.padEnd(MIN_FRACTION_DIGITS, "0")}`;
}

export function shortHash(hash: string, keep = 6): string {
  return hash.length <= keep * 2 + 1 ? hash : `${hash.slice(0, keep)}…${hash.slice(-keep)}`;
}

const compactFormatter = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

export function compact(value: number): string {
  return compactFormatter.format(value);
}

/** Signed whole-percent change from `before` to `after`; null when there is no baseline. */
export function percentChange(before: number, after: number): number | null {
  if (before === 0) return null;
  return Math.round(((after - before) / before) * 100);
}

export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function formatClock(iso: string): string {
  return new Date(iso).toISOString().slice(11, 19) + " UTC";
}
