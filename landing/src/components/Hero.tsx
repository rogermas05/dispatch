import { useRef, type CSSProperties } from "react";
import { useFrame } from "../lib/hooks";
import { clamp } from "../lib/math";
import { scrollState } from "../lib/scroll";

const HEADLINE = ["The agent", "that makes", "the phone call."] as const;
const EXIT_OVER_VIEWPORTS = 0.85;

export function Hero() {
  const innerRef = useRef<HTMLDivElement>(null);

  // The headline recedes as you scroll away, so leaving the hero reads as moving past it.
  useFrame(() => {
    const out = clamp(scrollState.y / (window.innerHeight * EXIT_OVER_VIEWPORTS));
    innerRef.current?.style.setProperty("--out", out.toFixed(3));
  });

  return (
    <section className="hero" id="top" data-phase="hero">
      <div className="container hero__inner" ref={innerRef}>
        <h1 className="hero__title">
          {HEADLINE.map((line, i) => (
            <span className="line" key={line}>
              <span className="line__inner" style={{ "--i": i } as CSSProperties}>
                {line}
              </span>
            </span>
          ))}
        </h1>
        <p className="hero__lede">
          Give Dispatch a number, a goal, and what it may agree to. It makes the call and comes back with a
          transcript and an outcome. Other AI agents can hire it too, paying per call through escrow on Cardano's
          test network.
        </p>
      </div>
    </section>
  );
}
