import { CircleCheck, Hourglass } from "lucide-react";
import { motion } from "motion/react";
import type { Feed, Order } from "@token-origins/schema";
import { agentColor, agentName, NEUTRAL_MARK } from "../lib/entities.ts";
import { formatAsset } from "../lib/format.ts";
import type { Snapshot } from "../lib/replay.ts";
import { Panel } from "./Panel.tsx";

interface Segment {
  id: string;
  label: string;
  share: number;
  color: string;
  value: string;
}

const MIN_INLINE_LABEL_SHARE = 0.16;

/** 100% bar with a 2px surface gap between segments; labels only where they fit. */
function SplitBar({ segments }: { segments: Segment[] }) {
  return (
    <div className="flex h-6 gap-[2px] overflow-hidden rounded">
      {segments.map((s, i) => (
        <motion.div
          key={s.id}
          title={`${s.label}: ${s.value}`}
          className="flex items-center justify-center text-[10.5px] font-semibold text-white"
          style={{ background: s.color }}
          initial={{ flexGrow: 0.0001 }}
          animate={{ flexGrow: s.share }}
          transition={{ duration: 0.7, delay: i * 0.08, ease: "easeOut" }}
        >
          {s.share >= MIN_INLINE_LABEL_SHARE && <span className="truncate px-1">{s.value}</span>}
        </motion.div>
      ))}
    </div>
  );
}

function OrderSplit({ feed, order, snapshot }: { feed: Feed; order: Order; snapshot: Snapshot }) {
  const stage = snapshot.orders[order.id];
  const collected = stage === "collected" || stage === "allocated";
  const allocations = feed.allocations.filter((a) => a.order_id === order.id);
  const amount = BigInt(order.collected_amount ?? order.amount);
  const fmt = (units: bigint) => `${formatAsset(units, feed.asset.decimals)}`;
  const buyerTask = feed.tasks.findIndex((t) => t.id === order.task_id) + 1;

  return (
    <div className="border-t border-line pt-2.5 first:border-t-0 first:pt-0">
      <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[11.5px]">
        <span className="text-ink">
          <span className="font-mono font-semibold">{order.experience_id}</span> sold to Task {buyerTask}
        </span>
        <span className="tabular text-ink-2">{fmt(amount)} {feed.asset.symbol}</span>
      </div>
      {collected && stage === "allocated" ? (
        <>
          <SplitBar
            segments={[
              ...allocations.map((a) => ({
                id: a.id,
                label: agentName(feed, a.recipient_id),
                share: Number(BigInt(a.amount)) / Number(amount),
                color: agentColor(a.recipient_id),
                value: `${agentName(feed, a.recipient_id).slice(-1)} ${fmt(BigInt(a.amount))}`,
              })),
              { id: "fee", label: "Platform fee", share: Number(BigInt(order.platform_fee ?? "0")) / Number(amount), color: NEUTRAL_MARK, value: fmt(BigInt(order.platform_fee ?? "0")) },
            ]}
          />
          <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
            {allocations.map((a) => {
              const paid = snapshot.paidAllocations.has(a.id);
              return (
                <li key={a.id} className="flex items-center gap-1 text-ink-2">
                  {paid ? <CircleCheck size={12} style={{ color: "var(--color-good)" }} aria-label="paid" /> : <Hourglass size={12} className="text-muted" aria-label="accrued, not yet paid" />}
                  {agentName(feed, a.recipient_id)} {fmt(BigInt(a.amount))} {paid ? "paid" : "accrued"}
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <p className="flex items-center gap-1.5 rounded border border-dashed border-line px-2 py-1.5 text-[11px] text-muted">
          <Hourglass size={12} aria-hidden /> In escrow until the dispute window closes; royalties are split only after collection.
        </p>
      )}
    </div>
  );
}

export function RoyaltyPanel({ feed, snapshot }: { feed: Feed; snapshot: Snapshot }) {
  const orders = feed.orders.filter((o) => snapshot.orders[o.id]);
  const newest = [...feed.experiences].reverse().find((e) => !e.seeded && e.parents.length > 0 && snapshot.published.has(e.id) && !feed.orders.some((o) => o.experience_id === e.id));
  const recipients = [...new Set([...feed.allocations.map((a) => a.recipient_id), ...(newest?.split.map((s) => s.recipient_id) ?? [])])];

  return (
    <Panel
      title="Royalties flow upstream"
      subtitle={`Creator keeps 80% of each derived sale; 20% flows to the experiences it built on. Platform fee ${feed.platform_fee_bps / 100}%.`}
    >
      {orders.length === 0 ? (
        <p className="pt-6 text-center text-xs text-muted">No experience has been sold yet.</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-3 text-[11px] text-ink-2" aria-label="Legend">
            {recipients.map((id) => (
              <span key={id} className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: agentColor(id) }} />{agentName(feed, id)}</span>
            ))}
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: NEUTRAL_MARK }} />Platform</span>
          </div>
          {orders.map((order) => <OrderSplit key={order.id} feed={feed} order={order} snapshot={snapshot} />)}
          {newest && (
            <div className="border-t border-line pt-2.5">
              <p className="mb-1.5 text-[11.5px] text-ink">
                Frozen split for the next sale of <span className="font-mono font-semibold">{newest.id}</span>
              </p>
              <SplitBar
                segments={newest.split.map((s) => ({
                  id: s.recipient_id,
                  label: agentName(feed, s.recipient_id),
                  share: s.bps / 10_000,
                  color: agentColor(s.recipient_id),
                  value: `${agentName(feed, s.recipient_id).slice(-1)} ${s.bps / 100}%`,
                }))}
              />
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
