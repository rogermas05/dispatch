import { Check } from "lucide-react";
import type { Feed, Task } from "@token-origins/schema";
import { agentColor, agentName } from "../lib/entities.ts";
import { TASK_STAGES, type Snapshot, type TaskProgress, type TaskStage } from "../lib/replay.ts";
import { Panel } from "./Panel.tsx";

const STAGE_LABELS: Record<TaskStage, string> = {
  queued: "Queued",
  received: "Received",
  searched: "Searched",
  buying: "Bought",
  working: "Working",
  verified: "Verified",
  delivered: "Delivered",
  published: "Published",
};

function stagesFor(task: Task): TaskStage[] {
  return task.search.decision === "purchase" ? TASK_STAGES : TASK_STAGES.filter((s) => s !== "buying");
}

function Stepper({ task, progress }: { task: Task; progress: TaskProgress }) {
  const stages = stagesFor(task);
  const reached = progress.stage === "queued" ? -1 : stages.indexOf(progress.stage);
  const color = agentColor(task.producer_id);
  return (
    <ol className="mt-2.5 flex items-center" aria-label="Task stages">
      {stages.map((stage, i) => {
        const done = i < reached || progress.stage === "published";
        const current = i === reached && progress.stage !== "published";
        return (
          <li key={stage} className="flex flex-1 items-center last:flex-none">
            <span
              title={STAGE_LABELS[stage]}
              className="relative grid size-4 shrink-0 place-items-center rounded-full"
              style={{
                background: done ? color : current ? "var(--color-surface)" : "var(--color-surface-2)",
                boxShadow: current ? `0 0 0 2px ${color}` : undefined,
              }}
            >
              {done && <Check size={10} strokeWidth={3.5} color="#fff" aria-hidden />}
              <span className="sr-only">{`${STAGE_LABELS[stage]}: ${done ? "done" : current ? "in progress" : "pending"}`}</span>
            </span>
            {i < stages.length - 1 && <span className="mx-0.5 h-0.5 flex-1 rounded" style={{ background: done ? color : "var(--color-line)" }} />}
          </li>
        );
      })}
    </ol>
  );
}

function TaskCard({ feed, task, index, progress, active }: { feed: Feed; task: Task; index: number; progress: TaskProgress; active: boolean }) {
  const color = agentColor(task.producer_id);
  const started = progress.stage !== "queued";
  const decided = ["searched", "buying", "working", "verified", "delivered", "published"].includes(progress.stage);
  return (
    <article
      className="rounded-lg border px-3 py-2.5 transition-colors duration-300"
      style={{ borderColor: active ? color : "var(--color-line)", background: active ? `color-mix(in oklab, ${color} 7%, var(--color-surface))` : undefined, opacity: started ? 1 : 0.5 }}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[13px] font-semibold">
          <span className="text-muted">Task {index + 1} · </span>
          {task.title}
        </p>
        <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-ink-2">
          <span className="size-2 rounded-full" style={{ background: color }} aria-hidden />
          {agentName(feed, task.producer_id)}
        </span>
      </div>
      <Stepper task={task} progress={progress} />
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted">
        <span>{STAGE_LABELS[progress.stage]}</span>
        {decided && (
          <span className="text-ink-2">
            {task.search.decision === "purchase" ? `Bought ${task.search.chosen_experience_id}` : "Cold start: nothing to reuse"}
          </span>
        )}
      </div>
      {progress.toolCalls > 0 && (
        <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-line pt-1.5 text-[11px]">
          <span className="truncate font-mono text-ink-2">{progress.lastToolLabel}</span>
          <span className="tabular shrink-0 text-ink">
            {progress.toolCalls} calls
            {progress.failedToolCalls > 0 && <span className="text-muted"> · {progress.failedToolCalls} failed</span>}
          </span>
        </div>
      )}
    </article>
  );
}

export function TaskPipeline({ feed, snapshot }: { feed: Feed; snapshot: Snapshot }) {
  return (
    <Panel className="flex-1" title="Sokosumi tasks" subtitle="Every task searches the network before doing fresh work">
      <div className="flex flex-col gap-2.5">
        {feed.tasks.map((task, i) => (
          <TaskCard
            key={task.id}
            feed={feed}
            task={task}
            index={i}
            progress={snapshot.tasks[task.id]!}
            active={snapshot.activeTaskId === task.id && snapshot.tasks[task.id]?.stage !== "published"}
          />
        ))}
      </div>
    </Panel>
  );
}
