import { CHAIN, LINKS } from "../lib/content";
import { HashLab } from "./HashLab";
import { Reveal } from "./primitives";

export function Proof() {
  return (
    <section className="proof section" id="proof" data-phase="ledger">
      <div className="container">
        <Reveal>
          <h2 className="display">Change one character.</h2>
          <p className="lede">
            Every paid call leaves two fingerprints on Cardano: one of the instruction Dispatch was given, and one
            of the result it delivered. Edit the transcript below and its fingerprint stops matching.
          </p>
        </Reveal>
        <Reveal delay={120}>
          <HashLab />
        </Reveal>
        <Reveal>
          <p className="proof__links">
            On-chain:{" "}
            <a className="link" href={`${LINKS.explorerTx}${CHAIN.resultTx}`} target="_blank" rel="noreferrer">
              the result of the call above
            </a>{" "}
            and{" "}
            <a className="link" href={`${LINKS.explorerTx}${CHAIN.registrationTx}`} target="_blank" rel="noreferrer">
              Dispatch's registration
            </a>
            .
          </p>
        </Reveal>
      </div>
    </section>
  );
}
