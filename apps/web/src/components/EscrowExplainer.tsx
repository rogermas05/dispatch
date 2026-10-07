import { motion } from "motion/react";
import { Panel } from "./Panel.tsx";

const STEPS = [
  ["Funds lock first", "The buyer locks the quoted amount before anything is dialed. Nobody has custody — not the buyer, not us, not Masumi."],
  ["Then the call happens", "Locked funds are the green light to dial. Menus, hold queues, the objective — inside the authority it was granted."],
  ["The result is committed", "A hash of the request and a hash of the transcript go on-chain. Neither is alterable afterwards."],
  ["Or the money comes back", "No call, no result hash — the escrow refunds the buyer automatically at the deadline."],
];

export function EscrowExplainer() {
  return (
    <Panel title="How a call is paid for" subtitle="Four steps. Three are automatic; the last is the interesting one.">
      <motion.ol initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col gap-2">
        {STEPS.map(([title, body], i) => (
          <li key={title} className="rounded-lg border border-line bg-surface-2 px-3 py-2">
            <p className="flex items-baseline gap-2 text-[13px] font-medium text-ink">
              <span className="font-mono text-[11px] text-muted">{String(i + 1).padStart(2, "0")}</span>
              {title}
            </p>
            <p className="mt-0.5 text-[11.5px] leading-snug text-muted">{body}</p>
          </li>
        ))}
      </motion.ol>
    </Panel>
  );
}
