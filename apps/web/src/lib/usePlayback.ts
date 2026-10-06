import { useCallback, useEffect, useState } from "react";
import type { FeedEvent } from "@token-origins/schema";

// Dwell time after each event, before the next one plays (ms at 1x).
const DWELL_MS: Partial<Record<FeedEvent["kind"], number>> = {
  agent_registered: 1200,
  registry_search: 3200,
  job_started: 2000,
  funds_locked: 2200,
  brief_parsed: 2600,
  dialing: 1600,
  transcript_turn: 2300,
  on_hold: 3000,
  call_ended: 1400,
  outcome_ready: 3200,
  result_submitted: 2400,
  result_delivered: 1800,
  hirer_resumed: 3600,
  payment_collected: 2200,
};
const DEFAULT_DWELL_MS = 1300;

export interface Playback {
  cursor: number;
  playing: boolean;
  speed: number;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  restart: () => void;
  step: (delta: number) => void;
  seek: (cursor: number) => void;
  setSpeed: (speed: number) => void;
}

/** Steps a cursor through the event log. Starts at the end so the full state shows on load. */
export function usePlayback(events: readonly FeedEvent[]): Playback {
  const total = events.length;
  const [cursor, setCursor] = useState(total);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    if (!playing) return;
    if (cursor >= total) {
      setPlaying(false);
      return;
    }
    const previous = events[cursor - 1];
    const dwell = previous ? (DWELL_MS[previous.kind] ?? DEFAULT_DWELL_MS) : 600;
    const timer = setTimeout(() => setCursor((c) => Math.min(total, c + 1)), dwell / speed);
    return () => clearTimeout(timer);
  }, [playing, cursor, total, speed, events]);

  const seek = useCallback((next: number) => setCursor(Math.max(0, Math.min(total, next))), [total]);
  const play = useCallback(() => {
    setCursor((c) => (c >= total ? 0 : c));
    setPlaying(true);
  }, [total]);
  const pause = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(() => (playing ? pause() : play()), [playing, pause, play]);
  const restart = useCallback(() => {
    setCursor(0);
    setPlaying(true);
  }, []);
  const step = useCallback(
    (delta: number) => {
      setPlaying(false);
      seek(cursor + delta);
    },
    [cursor, seek],
  );

  return { cursor, playing, speed, play, pause, toggle, restart, step, seek, setSpeed };
}
