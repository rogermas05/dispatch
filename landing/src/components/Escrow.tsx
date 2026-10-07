import { ESCROW_STEPS } from "../lib/content";
import { Reveal } from "./primitives";

/** How a call is paid for. Ends on the refund, which is the part worth hearing. */
export function Escrow() {
  return (
    <section className="escrow section" id="escrow" data-phase="ledger">
      <div className="container">
        <Reveal>
          <h2 className="display">Pay first. Or get it back.</h2>
          <p className="lede">
            Four steps, three of them automatic. None of it is visible to the person texting — they
            see a price, say yes, and get an answer.
          </p>
        </Reveal>
        <ol className="steps">
          {ESCROW_STEPS.map((s, i) => (
            <Reveal key={s.title} delay={80 * (i + 1)}>
              <li className="step">
                <span className="step__index">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <h3 className="card__title">{s.title}</h3>
                  <p className="card__body">{s.body}</p>
                </div>
              </li>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}
