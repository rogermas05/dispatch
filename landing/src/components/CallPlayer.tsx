import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { useFrame, useInView } from "../lib/hooks";
import { clamp, formatClock } from "../lib/math";
import { turnIndexAt, turnSpans } from "../lib/playback";
import { CALL, CHAIN, LINKS } from "../lib/content";

/** The exchange is short; playing it a little fast keeps it to one glance. */
const PLAYBACK_RATE = 1.8;
const KEY_STEP_SECONDS = 1;
const END = CALL.dialogueSeconds;
const SPANS = turnSpans(CALL.turns, END);
const SPEAKER_NAME = { dispatch: "Dispatch", them: "Person" } as const;

interface View {
  /** Turn being spoken, or -1 before the call starts. */
  index: number;
  /** Whole seconds elapsed, for the clock. */
  second: number;
}

/**
 * The first paid call as a player: it starts when scrolled into view, the
 * transcript fills in line by line, and the signal behind the page takes the
 * colour of whoever is speaking. Click the timeline or any line to jump.
 */
export function CallPlayer({ reducedMotion }: { reducedMotion: boolean }) {
  const [sectionRef, inView] = useInView<HTMLElement>("0px 0px -35% 0px");
  const time = useRef(0);
  const hasStarted = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [view, setView] = useState<View>({ index: -1, second: 0 });

  const moveTo = (seconds: number) => {
    const next = clamp(seconds, 0, END);
    time.current = next;
    sectionRef.current?.style.setProperty("--t", (next / END).toFixed(4));
    const index = turnIndexAt(CALL.turns, next);
    const second = Math.floor(next);
    setView((current) => (current.index === index && current.second === second ? current : { index, second }));
  };

  useEffect(() => {
    if (!inView || hasStarted.current) return;
    hasStarted.current = true;
    // With reduced motion nothing plays by itself: show the whole transcript at once.
    if (reducedMotion) moveTo(END);
    else setPlaying(true);
  });

  useFrame((delta) => {
    if (!playing) return;
    const next = time.current + delta * PLAYBACK_RATE;
    moveTo(next);
    if (next >= END) setPlaying(false);
  });

  const ended = !playing && view.second >= END;
  const seek = (seconds: number) => {
    moveTo(seconds);
    setPlaying(!reducedMotion && seconds < END);
  };
  const toggle = () => (ended ? seek(0) : setPlaying(!playing));

  const onTimelinePointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    seek(((event.clientX - rect.left) / rect.width) * END);
  };
  const onTimelineKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight") seek(time.current + KEY_STEP_SECONDS);
    if (event.key === "ArrowLeft") seek(time.current - KEY_STEP_SECONDS);
  };

  const speaking = view.index >= 0 && !ended ? CALL.turns[view.index]?.speaker : undefined;

  return (
    <section className="call" id="call" ref={sectionRef} data-phase={speaking ?? "silence"}>
      <div className="container">
        <h2 className="display">A call it made.</h2>
        <p className="lede">
          On 7 October 2026 a program hired Dispatch through its public API and locked 1 test USDM in escrow. It
          was a test: call a test line, confirm a test booking, and agree to nothing.
        </p>

        <div className="player">
          <div className="player__bar">
            <button type="button" className="player__toggle" onClick={toggle}>
              {ended ? "Replay" : playing ? "Pause" : "Play"}
            </button>
            <div
              className="timeline"
              role="slider"
              tabIndex={0}
              aria-label="Call position"
              aria-valuemin={0}
              aria-valuemax={END}
              aria-valuenow={view.second}
              aria-valuetext={formatClock(view.second)}
              onPointerDown={onTimelinePointer}
              onKeyDown={onTimelineKey}
            >
              {(["timeline__track", "timeline__played"] as const).map((layer) => (
                <div key={layer} className={layer} aria-hidden="true">
                  {SPANS.map((span, i) => (
                    <i
                      key={i}
                      className={`is-${CALL.turns[i]?.speaker}`}
                      style={{ left: `${span.start * 100}%`, width: `${span.width * 100}%` } as CSSProperties}
                    />
                  ))}
                </div>
              ))}
              <span className="timeline__head" aria-hidden="true" />
            </div>
            <p className="player__clock">
              {formatClock(view.second)} / {formatClock(END)}
            </p>
          </div>

          <ol className="lines">
            {CALL.turns.map((turn, i) => (
              <li key={i} className={i === view.index && !ended ? "is-now" : i <= view.index ? "is-said" : ""}>
                <button type="button" className={`line-row is-${turn.speaker}`} onClick={() => seek(turn.at)}>
                  <time>{formatClock(turn.at)}</time>
                  <span className="line-row__who">{SPEAKER_NAME[turn.speaker]}</span>
                  <span className="line-row__text">{turn.text}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>

        <p className="call__after">
          The whole call lasted {CALL.durationSeconds} seconds. Dispatch reported the objective met and agreed to
          nothing. A fingerprint of that result is{" "}
          <a className="link" href={`${LINKS.explorerTx}${CHAIN.resultTx}`} target="_blank" rel="noreferrer">
            on Cardano
          </a>
          , and the payment is released from escrow once the buyer's dispute window has passed.
        </p>
      </div>
    </section>
  );
}
