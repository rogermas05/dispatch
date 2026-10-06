import { motion } from "motion/react";
import { useState } from "react";
import type { Feed, RunMetrics } from "@token-origins/schema";
import { agentColor, agentName, NEUTRAL_MARK } from "../lib/entities.ts";
import { compact, formatDuration, percentChange } from "../lib/format.ts";
import type { Snapshot } from "../lib/replay.ts";
import { Panel } from "./Panel.tsx";

interface Measure {
  key: keyof RunMetrics;
  label: string;
  format: (value: number) => string;
}

// Different units, so each measure is its own small chart with its own scale.
const MEASURES: Measure[] = [
  { key: "tool_calls", label: "Tool calls", format: String },
  { key: "tokens", label: "Tokens", format: compact },
  { key: "duration_ms", label: "Time to result", format: formatDuration },
];

const BAR_HEIGHT = 14;

function Bar({ value, max, color, label, delay }: { value: number; max: number; color: string; label: string; delay: number }) {
  const [hover, setHover] = useState(false);
  return (
    <div className="relative flex items-center gap-2" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className="flex-1">
        <motion.div
          className="rounded-r"
          style={{ height: BAR_HEIGHT, background: color, maxWidth: "100%" }}
          initial={{ width: 0 }}
          animate={{ width: `${(value / max) * 100}%` }}
          transition={{ duration: 0.7, delay, ease: "easeOut" }}
        />
      </div>
      {hover && (
        <span role="tooltip" className="absolute -top-7 left-0 z-10 rounded-md border border-line bg-surface-2 px-2 py-1 text-[11px] whitespace-nowrap text-ink shadow-lg">
          {label}
        </span>
      )}
    </div>
  );
}

export function ComparisonChart({ feed, snapshot }: { feed: Feed; snapshot: Snapshot }) {
  const task = feed.tasks.find((t) => t.baseline);
  const ready = task && snapshot.tasks[task.id]?.stage === "published";
  const isMock = feed.mode === "mock";

  if (!task?.baseline || !ready) {
    return (
      <Panel title="Reused vs. solved cold" subtitle="Same fixture, same model, fresh context">
        <p className="pt-6 text-center text-xs text-muted">Appears once Task 2 finishes.</p>
      </Panel>
    );
  }

  const baseline = task.baseline;
  const assistedColor = agentColor(task.producer_id);
  const producer = agentName(feed, task.producer_id);

  return (
    <Panel title="Reused vs. solved cold" subtitle={`Task 2 on fixture B: ${producer} with exp_a vs. the same run without it`}>
      <div className="mb-3 flex items-center gap-4 text-[11px] text-ink-2" aria-label="Legend">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-3.5 rounded-sm" style={{ background: NEUTRAL_MARK }} />Solved cold</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-3.5 rounded-sm" style={{ background: assistedColor }} />With bought experience</span>
      </div>
      <div className="flex flex-col gap-3">
        {MEASURES.map((m, i) => {
          const before = baseline[m.key];
          const after = task.metrics[m.key];
          const change = percentChange(before, after);
          const max = Math.max(before, after);
          return (
            <div key={m.key}>
              <div className="mb-1 flex items-baseline justify-between text-[11.5px]">
                <span className="text-ink-2">{m.label}</span>
                {change !== null && (
                  <span className="tabular font-semibold" style={{ color: change < 0 ? "var(--color-good)" : "var(--color-ink)" }}>
                    {change > 0 ? "+" : ""}
                    {change}%
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-[3px]">
                <div className="flex items-center gap-2">
                  <div className="flex-1"><Bar value={before} max={max} color={NEUTRAL_MARK} label={`Solved cold: ${m.format(before)}`} delay={i * 0.12} /></div>
                  <span className="tabular w-14 shrink-0 text-right text-[11px] text-ink-2">{m.format(before)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1"><Bar value={after} max={max} color={assistedColor} label={`With exp_a: ${m.format(after)}`} delay={i * 0.12 + 0.06} /></div>
                  <span className="tabular w-14 shrink-0 text-right text-[11px] text-ink">{m.format(after)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] text-muted">
        {isMock ? "Mock values for layout only. Live runs replace them with measurements. " : ""}
        Assisted time excludes escrow settlement, which is shown separately.
      </p>
    </Panel>
  );
}
