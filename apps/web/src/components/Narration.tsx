import { AnimatePresence, motion } from "motion/react";
import { Play } from "lucide-react";
import type { Feed } from "@token-origins/schema";
import { DISPATCH_COLOR, jobColor } from "../lib/entities.ts";
import { EVENT_ICONS } from "../lib/eventIcons.ts";
import { formatClock } from "../lib/format.ts";
import type { Snapshot } from "../lib/replay.ts";

interface NarrationProps {
  feed: Feed;
  snapshot: Snapshot;
  onPlay: () => void;
}

/** One sentence that says what is happening right now; the caption track for the demo video. */
export function Narration({ feed, snapshot, onPlay }: NarrationProps) {
  const event = snapshot.current;
  const job = feed.jobs.find((j) => j.id === event?.job_id);
  const jobNumber = job ? feed.jobs.indexOf(job) + 1 : null;
  const Icon = event ? EVENT_ICONS[event.kind] : Play;
  const failed = event?.ok === false;
  const accent = failed ? "var(--color-critical)" : job ? jobColor(feed, job.id) : DISPATCH_COLOR;

  return (
    <div className="flex h-16 items-center gap-4 overflow-hidden rounded-xl border border-line bg-surface px-4">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={event?.id ?? "start"}
          className="flex min-w-0 flex-1 items-center gap-3.5"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -14 }}
          transition={{ duration: 0.28, ease: "easeOut" }}
        >
          <span
            className="grid size-9 shrink-0 place-items-center rounded-lg"
            style={{ background: `color-mix(in oklab, ${accent} 18%, transparent)`, color: accent }}
          >
            <Icon size={18} aria-hidden />
          </span>
          {event ? (
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[11px] text-muted">
                {jobNumber && <span className="font-semibold text-ink-2">Call {jobNumber}</span>}
                <span className="tabular">{formatClock(event.at)}</span>
                {failed && <span className="font-semibold" style={{ color: "var(--color-critical)" }}>Failed attempt</span>}
              </div>
              <p className="truncate text-[17px] font-medium">{event.label}</p>
            </div>
          ) : (
            <button type="button" onClick={onPlay} className="text-left text-[17px] font-medium text-ink-2 hover:text-ink">
              Press play: a person and an AI agent each hire Dispatch to make a call they can't or won't make.
            </button>
          )}
        </motion.div>
      </AnimatePresence>
      <span className="tabular shrink-0 text-xs text-muted">
        {snapshot.cursor} / {feed.events.length}
      </span>
    </div>
  );
}
