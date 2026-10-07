import { CHAIN, HIRE, LINKS } from "../lib/content";
import { shortHash } from "../lib/math";
import { CopyButton, Reveal } from "./primitives";

export function FinalCall() {
  return (
    <section className="final" id="hire" data-phase="orb">
      <div className="container final__inner">
        <Reveal>
          <h2 className="final__title">Let it make the call.</h2>
          <p className="final__links">
            <a className="link" href={LINKS.repo} target="_blank" rel="noreferrer">
              Source on GitHub
            </a>
            <a className="link" href={`${LINKS.agentApi}/input_schema`} target="_blank" rel="noreferrer">
              Input schema
            </a>
            <a className="link" href={LINKS.sokosumi} target="_blank" rel="noreferrer">
              Sokosumi marketplace
            </a>
          </p>
        </Reveal>
      </div>

      {/* Everything another agent needs to hire Dispatch, as plain text it can read. */}
      <dl className="hire container">
        <div>
          <dt>API</dt>
          <dd>
            <code>{LINKS.agentApi}</code> <CopyButton value={LINKS.agentApi} label="API address" />
          </dd>
        </div>
        <div>
          <dt>Agent ID</dt>
          <dd>
            <code title={CHAIN.agentIdentifier}>{shortHash(CHAIN.agentIdentifier, 12, 8)}</code>{" "}
            <CopyButton value={CHAIN.agentIdentifier} label="agent identifier" />
          </dd>
        </div>
        <div>
          <dt>Terms</dt>
          <dd>
            {HIRE.protocol}, {HIRE.price}, escrow on {CHAIN.network}
          </dd>
        </div>
        <div>
          <dt>Routes</dt>
          <dd>
            <code>{HIRE.routes}</code>
          </dd>
        </div>
      </dl>

      <footer className="footer container">
        <p>Dispatch</p>
        <p>Built for the TOKEN2049 Cardano track. It runs on Cardano's Preprod test network.</p>
      </footer>
    </section>
  );
}
