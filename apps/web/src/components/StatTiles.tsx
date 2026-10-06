import { motion } from "motion/react";
import type { Feed } from "@token-origins/schema";
import { formatAsset, formatDuration } from "../lib/format.ts";
import type { Snapshot } from "../lib/replay.ts";

interface TileProps {
  label: string;
  value: string;
  detail: string;
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
      <p className="mt-1.5 text-xs text-ink-2">{detail}</p>
    </div>
  );
}

export function StatTiles({ feed, snapshot }: { feed: Feed; snapshot: Snapshot }) {
  const asset = (units: bigint) => `${formatAsset(units, feed.asset.decimals)} ${feed.asset.symbol}`;
  return (
    <div className="grid grid-cols-4 gap-3">
      <Tile label="Calls completed" value={String(snapshot.callsCompleted)} detail={`For ${feed.hirers.length} hirers: a person and an AI agent`} />
      <Tile
        label="Hold time absorbed"
        value={snapshot.holdAbsorbedSeconds > 0 ? formatDuration(snapshot.holdAbsorbedSeconds * 1000) : "0s"}
        detail="Time nobody had to spend listening to hold music"
      />
      <Tile label="Collected by Dispatch" value={asset(snapshot.collectedTotal)} detail={`${asset(snapshot.lockedTotal)} still locked in escrow`} />
      <Tile label="On-chain commitments" value={String(snapshot.commitments)} detail="Input and transcript hashes: tamper-evident" />
    </div>
  );
}
