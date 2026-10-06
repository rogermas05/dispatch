import { Bot, Check, User } from "lucide-react";
import type { Feed, Job } from "@token-origins/schema";
import { hirerColor, hirerOf, partyName } from "../lib/entities.ts";
import { formatAsset, formatDuration } from "../lib/format.ts";
import type { JobProgress, JobStage, Snapshot } from "../lib/replay.ts";
import { Panel } from "./Panel.tsx";

const STEPS: { stage: JobStage; label: string }[] = [
  { stage: "searching", label: "Found in registry" },
  { stage: "hired", label: "Hired" },
  { stage: "funds_locked", label: "Funds locked" },
  { stage: "on_call", label: "On the call" },
  { stage: "outcome", label: "Outcome" },
  { stage: "committed", label: "Hash on-chain" },
  { stage: "delivered", label: "Delivered" },
  { stage: "collected", label: "Collected" },
];
const ORDER: JobStage[] = ["queued", "searching", "hired", "funds_locked", "dialing", "on_call", "outcome", "committed", "delivered", "collected"];

function stepsFor(feed: Feed, job: Job) {
  return hirerOf(feed, job)?.kind === "agent" ? STEPS : STEPS.filter((s) => s.stage !== "searching");
}

function Stepper({ feed, job, progress }: { feed: Feed; job: Job; progress: JobProgress }) {
  const steps = stepsFor(feed, job);
  const color = hirerColor(hirerOf(feed, job));
  const reached = ORDER.indexOf(progress.stage === "dialing" ? "on_call" : progress.stage);
  return (
    <ol className="mt-2.5 flex items-center" aria-label="Job stages">
      {steps.map((step, i) => {
        const at = ORDER.indexOf(step.stage);
        const done = at < reached || progress.stage === "collected";
        const current = at === reached && progress.stage !== "collected";
        return (
          <li key={step.stage} className="flex flex-1 items-center last:flex-none">
            <span
              title={step.label}
              className="grid size-4 shrink-0 place-items-center rounded-full"
              style={{
                background: done ? color : current ? "var(--color-surface)" : "var(--color-surface-2)",
                boxShadow: current ? `0 0 0 2px ${color}` : undefined,
              }}
            >
              {done && <Check size={10} strokeWidth={3.5} color="#fff" aria-hidden />}
              <span className="sr-only">{`${step.label}: ${done ? "done" : current ? "in progress" : "pending"}`}</span>
            </span>
            {i < steps.length - 1 && <span className="mx-0.5 h-0.5 flex-1 rounded" style={{ background: done ? color : "var(--color-line)" }} />}
          </li>
        );
      })}
    </ol>
  );
}

function stageLabel(feed: Feed, job: Job, progress: JobProgress): string {
  if (progress.stage === "dialing") return "Dialing";
  if (progress.holdSeconds != null) return "On hold, so nobody else has to be";
  return stepsFor(feed, job).find((s) => s.stage === progress.stage)?.label ?? "Waiting";
}

function JobCard({ feed, job, index, progress, active }: { feed: Feed; job: Job; index: number; progress: JobProgress; active: boolean }) {
  const hirer = hirerOf(feed, job);
  const color = hirerColor(hirer);
  const Icon = hirer?.kind === "agent" ? Bot : User;
  const started = progress.stage !== "queued";
  return (
    <article
      className="rounded-lg border px-3 py-2.5 transition-colors duration-300"
      style={{ borderColor: active ? color : "var(--color-line)", background: active ? `color-mix(in oklab, ${color} 7%, var(--color-surface))` : undefined, opacity: started ? 1 : 0.5 }}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[13px] font-semibold">
          <span className="text-muted">Call {index + 1} · </span>
          {job.title}
        </p>
        <span className="tabular shrink-0 text-[11px] text-ink-2">{formatAsset(BigInt(job.price), feed.asset.decimals)} {feed.asset.symbol}</span>
      </div>
      <p className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-ink-2">
        <Icon size={12} style={{ color }} aria-hidden />
        {hirer?.name} → {partyName(feed, job)}
      </p>
      <Stepper feed={feed} job={job} progress={progress} />
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
        <span className="text-muted">{stageLabel(feed, job, progress)}</span>
        {job.result && progress.turnsShown > 0 && (
          <span className="tabular text-ink-2">
            {progress.turnsShown}/{job.result.transcript.turns.length} turns · {formatDuration(job.result.durationSeconds * 1000)}
          </span>
        )}
      </div>
      {job.hirer_task && (
        <p className="mt-1.5 border-t border-line pt-1.5 text-[11px] text-muted">
          <span className="text-ink-2">Its own task:</span> {job.hirer_task.title}
          {progress.hirerResumed && <span className="text-ink"> · closed</span>}
        </p>
      )}
    </article>
  );
}

export function JobPipeline({ feed, snapshot }: { feed: Feed; snapshot: Snapshot }) {
  return (
    <Panel className="flex-1" title="Calls" subtitle="Funds lock in escrow before Dispatch dials">
      <div className="flex flex-col gap-2.5">
        {feed.jobs.map((job, i) => (
          <JobCard
            key={job.id}
            feed={feed}
            job={job}
            index={i}
            progress={snapshot.jobs[job.id]!}
            active={snapshot.activeJobId === job.id && snapshot.jobs[job.id]?.stage !== "collected"}
          />
        ))}
      </div>
    </Panel>
  );
}
