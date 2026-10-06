import { Hourglass, PhoneCall } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";
import type { Feed, Job } from "@token-origins/schema";
import { DISPATCH_COLOR, partyName } from "../lib/entities.ts";
import { formatDuration } from "../lib/format.ts";
import type { Snapshot } from "../lib/replay.ts";
import { Panel } from "./Panel.tsx";

interface HoldMarker {
  afterTurn: number;
  seconds: number;
}

/** Holds that have already happened for a job, placed after the turn that preceded them. */
function holdsFor(feed: Feed, job: Job, cursor: number): HoldMarker[] {
  const markers: HoldMarker[] = [];
  let lastTurn = -1;
  for (const event of feed.events.slice(0, cursor)) {
    if (event.job_id !== job.id) continue;
    if (event.kind === "transcript_turn") lastTurn = event.turn_index ?? lastTurn;
    if (event.kind === "on_hold") markers.push({ afterTurn: lastTurn, seconds: event.hold_seconds ?? 0 });
  }
  return markers;
}

const clock = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export function TranscriptPanel({ feed, snapshot }: { feed: Feed; snapshot: Snapshot }) {
  const withTurns = feed.jobs.filter((j) => (snapshot.jobs[j.id]?.turnsShown ?? 0) > 0 || snapshot.jobs[j.id]?.stage === "dialing");
  const job = withTurns.find((j) => j.id === snapshot.activeJobId) ?? withTurns.at(-1);
  const scroller = useRef<HTMLDivElement>(null);
  const progress = job ? snapshot.jobs[job.id] : undefined;

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [progress?.turnsShown, progress?.holdSeconds]);

  if (!job || !job.result || !progress) {
    return (
      <Panel className="flex-1" title="Live transcript" subtitle="What was said, turn by turn">
        <p className="pt-10 text-center text-xs text-muted">No call in progress.</p>
      </Panel>
    );
  }

  const party = partyName(feed, job);
  const turns = job.result.transcript.turns.slice(0, progress.turnsShown);
  const holds = holdsFor(feed, job, snapshot.cursor);
  const live = progress.stage === "dialing" || progress.stage === "on_call";

  return (
    <Panel
      className="flex-1"
      title="Live transcript"
      subtitle={`Call ${feed.jobs.indexOf(job) + 1}: Dispatch ↔ ${party}`}
      action={
        live ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: DISPATCH_COLOR }}>
            <PhoneCall size={12} aria-hidden /> Live
          </span>
        ) : null
      }
    >
      <div ref={scroller} className="flex h-full flex-col gap-1.5 overflow-y-auto pr-1">
        {progress.stage === "dialing" && turns.length === 0 && <p className="pt-8 text-center text-xs text-muted">Dialing {party}…</p>}
        <AnimatePresence initial={false}>
          {turns.map((turn, i) => {
            const isAgent = turn.speaker === "agent";
            const hold = holds.find((h) => h.afterTurn === i);
            return (
              <motion.div key={`${job.id}-${i}`} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-1.5">
                <div className={`flex flex-col ${isAgent ? "items-end" : "items-start"}`}>
                  <span className="mb-0.5 text-[10px] text-muted">
                    {isAgent ? "Dispatch (AI)" : party} · <span className="tabular">{clock(turn.atSeconds)}</span>
                  </span>
                  <p
                    className="max-w-[88%] rounded-xl px-2.5 py-1.5 text-[12.5px] leading-snug"
                    style={
                      isAgent
                        ? { background: `color-mix(in oklab, ${DISPATCH_COLOR} 24%, var(--color-surface))`, borderTopRightRadius: 4 }
                        : { background: "var(--color-surface-2)", borderTopLeftRadius: 4 }
                    }
                  >
                    {turn.text}
                  </p>
                </div>
                {hold && (
                  <div className="my-1 flex items-center gap-2 text-[11px] text-muted">
                    <span className="h-px flex-1 bg-line" />
                    <Hourglass size={12} style={{ color: "var(--color-warning)" }} aria-hidden />
                    On hold {formatDuration(hold.seconds * 1000)}: Dispatch waited, nobody else did
                    <span className="h-px flex-1 bg-line" />
                  </div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </Panel>
  );
}
