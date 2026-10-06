import { Pause, Play, RotateCcw, SkipBack, SkipForward } from "lucide-react";
import type { Feed } from "@token-origins/schema";
import { jobColor, TOKEN_COLOR } from "../lib/entities.ts";
import type { Playback } from "../lib/usePlayback.ts";

const SPEEDS = [1, 2, 4];

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid size-8 place-items-center rounded-lg text-ink-2 hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-ink-2"
    >
      {children}
    </button>
  );
}

export function PlaybackBar({ feed, playback }: { feed: Feed; playback: Playback }) {
  const total = feed.events.length;
  const markers = feed.events
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.kind === "job_started" || e.kind === "outcome_ready" || e.kind === "payment_collected");

  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2">
      <button
        type="button"
        onClick={playback.toggle}
        className="flex h-8 items-center gap-1.5 rounded-lg bg-ink px-3 text-[13px] font-semibold text-page hover:bg-ink-2"
      >
        {playback.playing ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
        {playback.playing ? "Pause" : playback.cursor >= total ? "Replay story" : "Play"}
      </button>
      <IconButton label="Restart from the beginning" onClick={playback.restart}><RotateCcw size={15} /></IconButton>
      <IconButton label="Previous event" onClick={() => playback.step(-1)}><SkipBack size={15} /></IconButton>
      <IconButton label="Next event" onClick={() => playback.step(1)}><SkipForward size={15} /></IconButton>

      <div className="relative mx-2 flex-1">
        <input
          type="range"
          min={0}
          max={total}
          value={playback.cursor}
          onChange={(e) => playback.seek(Number(e.target.value))}
          aria-label="Story position"
          className="w-full accent-[var(--color-ink-2)]"
        />
        <div className="pointer-events-none absolute inset-x-0 -bottom-1 h-1.5" aria-hidden>
          {markers.map(({ e, i }) => (
            <span
              key={e.id}
              className="absolute top-0 h-1.5 w-[3px] -translate-x-1/2 rounded-full"
              style={{
                left: `${(i / total) * 100}%`,
                background: e.kind === "payment_collected" ? TOKEN_COLOR : jobColor(feed, e.job_id),
              }}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center gap-0.5 rounded-lg border border-line p-0.5" role="group" aria-label="Playback speed">
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => playback.setSpeed(s)}
            aria-pressed={playback.speed === s}
            className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${playback.speed === s ? "bg-surface-2 text-ink" : "text-muted hover:text-ink-2"}`}
          >
            {s}×
          </button>
        ))}
      </div>
      <span className="hidden text-[11px] text-muted xl:inline">Space to play · ← → to step</span>
    </div>
  );
}
