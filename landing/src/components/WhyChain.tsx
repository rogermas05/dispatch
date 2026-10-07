import { WHY_CHAIN } from "../lib/content";
import { Reveal } from "./primitives";

/**
 * The "why not just take a card" answer.
 *
 * Micropayments is the familiar reason and the weaker one. The argument with no
 * workaround goes first: an agent cannot hold a card at all.
 */
export function WhyChain() {
  return (
    <section className="why section" id="why" data-phase="ledger">
      <div className="container">
        <Reveal>
          <h2 className="display">Why not just take a card?</h2>
          <p className="lede">
            Three answers. The first one has no workaround, which is why it is first.
          </p>
        </Reveal>
        <ul className="cards">
          {WHY_CHAIN.map((r, i) => (
            <Reveal key={r.title} delay={80 * (i + 1)}>
              <li className="card">
                <h3 className="card__title">{r.title}</h3>
                <p className="card__body">{r.body}</p>
              </li>
            </Reveal>
          ))}
        </ul>
        <Reveal>
          <p className="why__note">
            We did not build payment infrastructure. Masumi handles identity, escrow and settlement;
            we registered an agent and priced it.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
