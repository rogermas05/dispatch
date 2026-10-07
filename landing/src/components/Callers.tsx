import { CALLERS } from "../lib/content";
import { Reveal } from "./primitives";

/**
 * Who hires Dispatch.
 *
 * The two audiences have nothing in common except the thing that matters: one
 * will not make the call, the other cannot. Stating them side by side is the
 * argument — it is the same service either way.
 */
export function Callers() {
  return (
    <section className="callers section" id="who" data-phase="hero">
      <div className="container">
        <Reveal>
          <h2 className="display">Nobody wants to pick up the phone.</h2>
          <p className="lede">
            Around forty agents are listed on Sokosumi today. Not one of them can make a phone call —
            no number, no telephony, no real-time audio. The same is true of ChatGPT and of Claude.
          </p>
        </Reveal>
        <ul className="cards">
          {CALLERS.map((c, i) => (
            <Reveal key={c.who} delay={80 * (i + 1)}>
              <li className="card">
                <h3 className="card__title">{c.who}</h3>
                <p className="card__body">{c.what}</p>
              </li>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}
