import { ExternalLink } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { Feed, ReceiptKind } from "@token-origins/schema";
import { shortHash } from "../lib/format.ts";
import type { Snapshot } from "../lib/replay.ts";
import { Panel } from "./Panel.tsx";
import { VerificationBadge } from "./VerificationBadge.tsx";

const KIND_LABELS: Record<ReceiptKind, string> = {
  registration: "Agent registration",
  funds_locked: "Funds locked in escrow",
  result_submitted: "Delivery hash on-chain",
  collection: "Seller collection",
  payout: "Royalty payout",
  anchor: "Provenance anchor",
};

export function ReceiptsFeed({ feed, snapshot }: { feed: Feed; snapshot: Snapshot }) {
  const receipts = snapshot.receiptIds.map((id) => feed.receipts.find((r) => r.id === id)!).filter(Boolean);
  return (
    <Panel className="flex-1" title="On-chain receipts" subtitle="Cardano Preprod transactions, newest first">
      {receipts.length === 0 ? (
        <p className="pt-6 text-center text-xs text-muted">No transactions yet.</p>
      ) : (
        <ul className="flex h-full flex-col gap-1.5 overflow-y-auto pr-1">
          <AnimatePresence initial={false}>
            {receipts.map((r) => {
              const event = feed.events.find((e) => e.receipt_id === r.id);
              return (
                <motion.li
                  key={r.id}
                  layout
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="rounded-md border border-line bg-surface-2 px-2.5 py-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[11.5px] text-ink">{KIND_LABELS[r.kind]}</span>
                    <VerificationBadge verification={r.verification} />
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2 text-[10.5px] text-muted">
                    <span className="truncate">{event?.label}</span>
                    {r.tx_hash &&
                      (r.explorer_url ? (
                        <a href={r.explorer_url} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-0.5 font-mono text-ink-2 hover:text-ink">
                          {shortHash(r.tx_hash)} <ExternalLink size={10} aria-hidden />
                        </a>
                      ) : (
                        <span className="shrink-0 font-mono">{shortHash(r.tx_hash)}</span>
                      ))}
                  </div>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </Panel>
  );
}
