import { lerp } from "../lib/math";

type Rgb = readonly [number, number, number];

/** Everything the signal can express. Each page section owns one of these. */
export interface SignalParams {
  /** Wave height. Near zero reads as a flat line: silence, or hold. */
  amp: number;
  /** High-frequency detail and grit. */
  chaos: number;
  /** 0 = one blended voice, 1 = two distinct voices. */
  split: number;
  /** 0 = smooth wave, 1 = stepped into blocks. */
  quant: number;
  /** 0 = lines, 1 = wrapped into a ring. */
  ring: number;
  bright: number;
  /** Vertical centre in shader units (-0.5 bottom, 0.5 top). */
  y: number;
  colA: Rgb;
  colB: Rgb;
}

const SIGNAL: Rgb = [0.16, 0.9, 0.64];
const DEEP_BLUE: Rgb = [0.2, 0.48, 1.0];
const TEAL: Rgb = [0.14, 0.7, 0.78];
const EMBER: Rgb = [1.0, 0.46, 0.22];
const GOLD: Rgb = [0.96, 0.72, 0.28];
const ASH: Rgb = [0.34, 0.42, 0.4];

const HORIZON = -0.37;

export const PHASES = {
  hero: { amp: 0.15, chaos: 0.8, split: 0, quant: 0, ring: 0, bright: 1, y: 0.02, colA: SIGNAL, colB: DEEP_BLUE },
  silence: { amp: 0.01, chaos: 0.2, split: 0, quant: 0, ring: 0, bright: 0.5, y: HORIZON, colA: ASH, colB: ASH },
  // The two voices of the call. Colour means speaker everywhere on the page.
  dispatch: { amp: 0.1, chaos: 0.45, split: 0, quant: 0, ring: 0, bright: 0.62, y: HORIZON, colA: SIGNAL, colB: TEAL },
  them: { amp: 0.14, chaos: 1, split: 0, quant: 0, ring: 0, bright: 0.62, y: HORIZON, colA: EMBER, colB: GOLD },
  ledger: { amp: 0.085, chaos: 0.5, split: 0, quant: 1, ring: 0, bright: 0.5, y: HORIZON, colA: GOLD, colB: SIGNAL },
  orb: { amp: 0.2, chaos: 0.8, split: 0, quant: 0, ring: 1, bright: 1.05, y: 0, colA: SIGNAL, colB: GOLD },
} satisfies Record<string, SignalParams>;

export type PhaseName = keyof typeof PHASES;

/** Where the hero wave sits on a portrait screen: behind the headline, clear of the paragraph. */
const HERO_PORTRAIT_Y = 0.19;

export function phaseParams(name: PhaseName, portrait: boolean): SignalParams {
  return name === "hero" && portrait ? { ...PHASES.hero, y: HERO_PORTRAIT_Y } : PHASES[name];
}

export function isPhaseName(value: string | undefined): value is PhaseName {
  return value !== undefined && value in PHASES;
}

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

export function mixParams(a: SignalParams, b: SignalParams, t: number): SignalParams {
  return {
    amp: lerp(a.amp, b.amp, t),
    chaos: lerp(a.chaos, b.chaos, t),
    split: lerp(a.split, b.split, t),
    quant: lerp(a.quant, b.quant, t),
    ring: lerp(a.ring, b.ring, t),
    bright: lerp(a.bright, b.bright, t),
    y: lerp(a.y, b.y, t),
    colA: mixRgb(a.colA, b.colA, t),
    colB: mixRgb(a.colB, b.colB, t),
  };
}
