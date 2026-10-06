import { Ban, ShoppingCart } from "lucide-react";
import { motion } from "motion/react";
import type { Feed } from "@token-origins/schema";
import { experienceColor, NEUTRAL_MARK } from "../lib/entities.ts";
import type { Snapshot } from "../lib/replay.ts";
import { Panel } from "./Panel.tsx";

const SEARCHED_STAGES = new Set(["searched", "buying", "working", "verified", "delivered", "published"]);

export function SearchPanel({ feed, snapshot }: { feed: Feed; snapshot: Snapshot }) {
  const searchedTasks = feed.tasks.filter((t) => SEARCHED_STAGES.has(snapshot.tasks[t.id]?.stage ?? ""));
  const task = searchedTasks.find((t) => t.id === snapshot.activeTaskId) ?? searchedTasks.at(-1);

  if (!task) {
    return (
      <Panel title="Search before work" subtitle="Ranked matches for the current task">
        <p className="pt-6 text-center text-xs text-muted">No task has searched yet.</p>
      </Panel>
    );
  }

  const taskNumber = feed.tasks.indexOf(task) + 1;
  return (
    <Panel title="Search before work" subtitle={`Task ${taskNumber}: "${task.search.query}"`}>
      <ul className="flex flex-col gap-1.5" aria-label="Search results">
        {task.search.hits.map((hit, i) => {
          const experience = feed.experiences.find((e) => e.id === hit.experience_id)!;
          const chosen = hit.experience_id === task.search.chosen_experience_id;
          const color = chosen ? experienceColor(feed, hit.experience_id) : NEUTRAL_MARK;
          return (
            <li key={`${task.id}-${hit.experience_id}`} title={`score ${hit.score.toFixed(3)} · relevance ${hit.components.relevance} · context match ${hit.components.context_match}`}>
              <div className="flex items-center justify-between gap-2 text-[11.5px]">
                <span className={`truncate ${chosen ? "font-semibold text-ink" : "text-ink-2"}`}>{experience.problem}</span>
                <span className="tabular shrink-0 text-ink-2">{hit.score.toFixed(2)}</span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <div className="h-2 flex-1 overflow-hidden rounded-r bg-surface-2">
                  <motion.div
                    className="h-full rounded-r"
                    style={{ background: color }}
                    initial={{ width: 0 }}
                    animate={{ width: `${hit.score * 100}%` }}
                    transition={{ duration: 0.6, delay: i * 0.06, ease: "easeOut" }}
                  />
                </div>
                {chosen ? (
                  <span className="inline-flex w-[88px] shrink-0 items-center gap-1 text-[10.5px] font-semibold text-ink">
                    <ShoppingCart size={11} aria-hidden /> Bought
                  </span>
                ) : (
                  <span className="inline-flex w-[88px] shrink-0 items-center gap-1 text-[10.5px] text-muted">
                    {!hit.compatible && <Ban size={11} aria-hidden />}
                    {hit.compatible ? "Compatible" : "Incompatible"}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[11px] text-muted">
        {task.search.decision === "cold_start"
          ? "No compatible experience: the agent solves it from scratch, then publishes what it learned."
          : "Score ranks matches; it is not a promise of success. Incompatible API versions are never bought."}
      </p>
    </Panel>
  );
}
