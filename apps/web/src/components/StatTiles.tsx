import { ArrowDownRight } from "lucide-react";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import type { Feed } from "@token-origins/schema";
import { formatAsset, percentChange } from "../lib/format.ts";
import type { Snapshot } from "../lib/replay.ts";

interface TileProps {
  label: string;
  value: string;
  detail: ReactNode;
}

function Tile({ label, value, detail }: TileProps) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <motion.p
        key={value}
        className="mt-1 text-[28px] leading-none font-semibold"
        initial={{ opacity: 0.3, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        {value}
      </motion.p>
      <div className="mt-1.5 text-xs text-ink-2">{detail}</div>
    </div>
  );
}

export function StatTiles({ feed, snapshot }: { feed: Feed; snapshot: Snapshot }) {
  const storyExperiences = feed.experiences.filter((e) => !e.seeded);
  const purchases = Object.keys(snapshot.orders).length;
  const comparisonTask = feed.tasks.find((t) => t.baseline);
  const comparisonReady = comparisonTask && snapshot.tasks[comparisonTask.id]?.stage === "published";
  const change = comparisonTask?.baseline ? percentChange(comparisonTask.baseline.tool_calls, comparisonTask.metrics.tool_calls) : null;

  return (
    <div className="grid grid-cols-4 gap-3">
      <Tile
        label="Experiences published"
        value={`${snapshot.published.size} / ${storyExperiences.length}`}
        detail="Signed, verified by a fixture, searchable"
      />
      <Tile label="Experiences bought and reused" value={String(purchases)} detail="Each through Masumi escrow on Cardano" />
      <Tile
        label="Tool calls vs. solving cold"
        value={comparisonReady && change !== null ? `${change}%` : "–"}
        detail={
          comparisonReady && comparisonTask?.baseline ? (
            <span className="inline-flex items-center gap-1">
              <ArrowDownRight size={13} style={{ color: "var(--color-good)" }} aria-label="fewer" />
              {comparisonTask.metrics.tool_calls} vs {comparisonTask.baseline.tool_calls} on the same fixture
            </span>
          ) : (
            "Shown once Task 2 finishes"
          )
        }
      />
      <Tile
        label="Royalties paid to contributors"
        value={`${formatAsset(snapshot.paidTotal, feed.asset.decimals)} ${feed.asset.symbol}`}
        detail={`${snapshot.paidAllocations.size} of ${feed.allocations.length} payouts confirmed`}
      />
    </div>
  );
}
