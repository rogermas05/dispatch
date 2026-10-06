import { Bot, CircleAlert, UserRound } from "lucide-react";
import { motion } from "motion/react";
import type { Feed } from "@token-origins/schema";
import { hirerOf } from "../lib/entities.ts";
import type { Snapshot } from "../lib/replay.ts";
import { Panel } from "./Panel.tsx";

const HAS_OUTCOME = new Set(["outcome", "committed", "delivered", "collected"]);

export function OutcomePanel({ feed, snapshot }: { feed: Feed; snapshot: Snapshot }) {
  const ready = feed.jobs.filter((j) => HAS_OUTCOME.has(snapshot.jobs[j.id]?.stage ?? ""));
  const job = ready.find((j) => j.id === snapshot.activeJobId) ?? ready.at(-1);

  if (!job?.result) {
    return (
      <Panel title="Outcome" subtitle="What the call achieved, as a structured result">
        <p className="pt-6 text-center text-xs text-muted">Appears when a call ends.</p>
      </Panel>
    );
  }

  const { result } = job;
  const hirer = hirerOf(feed, job);
  const resumed = snapshot.jobs[job.id]?.hirerResumed;

  return (
    <Panel title="Outcome" subtitle={`Call ${feed.jobs.indexOf(job) + 1}: returned to ${hirer?.name}`}>
      <motion.div key={job.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col gap-2.5">
        <p className="text-[13px] leading-snug text-ink">{result.summary}</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[11.5px]">
          {Object.entries(result.artifacts).map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-muted">{key}</dt>
              <dd className="font-medium text-ink">{value}</dd>
            </div>
          ))}
        </dl>
        {result.humanFollowUp && (
          <p className="flex gap-1.5 text-[11.5px] text-ink-2">
            <UserRound size={13} className="mt-0.5 shrink-0" aria-hidden />
            <span><span className="text-ink">Human follow-up:</span> {result.humanFollowUp}</span>
          </p>
        )}
        {job.hirer_task && resumed && (
          <p className="flex gap-1.5 text-[11.5px] text-ink-2">
            <Bot size={13} className="mt-0.5 shrink-0" style={{ color: "var(--color-hirer-agent)" }} aria-hidden />
            <span><span className="text-ink">{hirer?.name} resumed its task:</span> {job.hirer_task.resolution}</span>
          </p>
        )}
        <ul className="flex flex-col gap-1 text-[11px] text-muted">
          {result.caveats.map((caveat) => (
            <li key={caveat} className="flex gap-1.5">
              <CircleAlert size={12} className="mt-px shrink-0" aria-hidden />
              {caveat}
            </li>
          ))}
        </ul>
      </motion.div>
    </Panel>
  );
}
