export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

export function smoothstep(t: number): number {
  const x = clamp(t);
  return x * x * (3 - 2 * x);
}

/** Frame-rate independent smoothing factor for `value += (target - value) * damp(...)`. */
export function damp(rate: number, deltaSeconds: number): number {
  return 1 - Math.exp(-rate * deltaSeconds);
}

/** Seconds → "mm:ss", or "hh:mm:ss" once an hour has passed. */
export function formatClock(totalSeconds: number): string {
  const whole = Math.max(0, Math.floor(totalSeconds));
  const pad = (n: number) => String(n).padStart(2, "0");
  const hours = Math.floor(whole / 3600);
  const rest = `${pad(Math.floor((whole % 3600) / 60))}:${pad(whole % 60)}`;
  return hours > 0 ? `${pad(hours)}:${rest}` : rest;
}

export interface Segment {
  /** Index of the stop at or before `position`. */
  index: number;
  /** 0..1 eased progress toward the next stop. */
  t: number;
}

/** Locate `position` among ascending `stops`, clamped at both ends. */
export function segmentAt(stops: readonly number[], position: number): Segment {
  const last = stops.length - 1;
  if (last <= 0) return { index: 0, t: 0 };
  for (let i = 0; i < last; i++) {
    const from = stops[i] ?? 0;
    const to = stops[i + 1] ?? from;
    if (position < to) {
      const span = to - from;
      return { index: i, t: span > 0 ? smoothstep((position - from) / span) : 0 };
    }
  }
  return { index: last, t: 0 };
}

/** Shorten a hex string to "abcdef12…9f3e" for display. */
export function shortHash(hash: string, head = 8, tail = 6): string {
  return hash.length <= head + tail + 1 ? hash : `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}
