import { CircleCheck, CircleX, PencilLine, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import type { Feed } from "@token-origins/schema";
import { shortHash } from "../lib/format.ts";
import type { Snapshot } from "../lib/replay.ts";
import { tamper, verifyCommitment, type CommitmentCheck } from "../lib/verify.ts";
import { Panel } from "./Panel.tsx";

const COMMITTED = new Set(["committed", "delivered", "collected"]);
const FUNDED = new Set(["funds_locked", "dialing", "on_call", "outcome", ...COMMITTED]);

function HashRow({ label, expected, check }: { label: string; expected: string | null; check: CommitmentCheck | null }) {
  const ok = check?.matches;
  return (
    <div className="flex items-center justify-between gap-2 text-[11.5px]">
      <span className="text-ink-2">{label}</span>
      {expected ? (
        <span className="flex items-center gap-1.5 font-mono">
          <span className="text-muted">{shortHash(expected, 8)}</span>
          {check && (
            <span className="inline-flex items-center gap-1 font-sans font-semibold" style={{ color: ok ? "var(--color-good)" : "var(--color-critical)" }}>
              {ok ? <CircleCheck size={13} aria-hidden /> : <CircleX size={13} aria-hidden />}
              {ok ? "matches" : "mismatch"}
            </span>
          )}
        </span>
      ) : (
        <span className="text-muted">not committed yet</span>
      )}
    </div>
  );
}

export function ProofPanel({ feed, snapshot }: { feed: Feed; snapshot: Snapshot }) {
  const funded = feed.jobs.filter((j) => FUNDED.has(snapshot.jobs[j.id]?.stage ?? ""));
  const job = funded.find((j) => j.id === snapshot.activeJobId) ?? funded.at(-1);
  const committed = job ? COMMITTED.has(snapshot.jobs[job.id]?.stage ?? "") : false;
  const [checks, setChecks] = useState<{ jobId: string; input: CommitmentCheck; output: CommitmentCheck | null; tampered: boolean } | null>(null);

  useEffect(() => setChecks(null), [job?.id, committed]);

  if (!job) {
    return (
      <Panel title="On-chain proof" subtitle="What Dispatch was allowed to do, and what was said">
        <p className="pt-6 text-center text-xs text-muted">Appears once a hirer locks funds.</p>
      </Panel>
    );
  }

  const run = async (tampered: boolean) => {
    const nonce = job.identifier_from_purchaser;
    const input = await verifyCommitment(job.input, job.input_hash, nonce);
    const output = committed && job.output_hash ? await verifyCommitment(tampered && job.result ? tamper(job.result) : job.result, job.output_hash, nonce) : null;
    setChecks({ jobId: job.id, input, output, tampered });
  };
  const current = checks?.jobId === job.id ? checks : null;

  return (
    <Panel title="On-chain proof" subtitle={`Call ${feed.jobs.indexOf(job) + 1}: hashes Masumi logged on Cardano`}>
      <div className="flex flex-col gap-2.5">
        <div className="rounded-lg border border-line bg-surface-2 px-3 py-2">
          <p className="text-[10.5px] tracking-wide text-muted uppercase">Authorization (hashed into the input)</p>
          <p className="mt-0.5 text-[12px] leading-snug text-ink">{job.input.authorization}</p>
        </div>
        <HashRow label="Input hash: the request" expected={job.input_hash} check={current?.input ?? null} />
        <HashRow label="Output hash: the transcript" expected={committed ? job.output_hash : null} check={current?.output ?? null} />
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => run(false)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-[11.5px] font-semibold text-ink hover:bg-surface-2"
          >
            <ShieldCheck size={13} aria-hidden /> Recompute in your browser
          </button>
          {committed && (
            <button
              type="button"
              onClick={() => run(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-[11.5px] text-ink-2 hover:bg-surface-2"
            >
              <PencilLine size={13} aria-hidden /> Change one digit, then check
            </button>
          )}
        </div>
        <p className="text-[11px] text-muted">
          {current?.tampered
            ? "One changed digit in the transcript produces a different hash, so an edited record can't pass as the original."
            : "SHA-256 over the same canonical JSON the agent API committed. Proves what was asked and said, not that it was true."}
        </p>
      </div>
    </Panel>
  );
}
