interface Timed {
  /** Seconds at which this turn starts. */
  at: number;
}

/** Index of the turn being spoken at `time`, or -1 before the first one starts. */
export function turnIndexAt(turns: readonly Timed[], time: number): number {
  let index = -1;
  for (let i = 0; i < turns.length; i++) {
    if ((turns[i]?.at ?? Infinity) <= time) index = i;
  }
  return index;
}

export interface Span {
  /** 0..1 position of the turn's start along the timeline. */
  start: number;
  /** 0..1 share of the timeline the turn occupies. */
  width: number;
}

/** Each turn runs until the next one starts; the last runs to `end`. */
export function turnSpans(turns: readonly Timed[], end: number): Span[] {
  return turns.map((turn, i) => {
    const until = turns[i + 1]?.at ?? end;
    return { start: turn.at / end, width: Math.max(0, until - turn.at) / end };
  });
}
