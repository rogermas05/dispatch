import { CreditCard, Coins, ShieldCheck } from "lucide-react";
import { motion } from "motion/react";
import { Panel } from "./Panel.tsx";

const REASONS = [
  {
    icon: <CreditCard size={13} aria-hidden />,
    title: "An agent can't hold a card",
    body: "No KYC, no CVV, no merchant account. When an agent needs to buy one call at 3am there is no card to charge — there is a wallet.",
  },
  {
    icon: <Coins size={13} aria-hidden />,
    title: "The amounts are tiny",
    body: "Calls cost 20–80¢. Card rails carry a fixed floor near 30¢, which makes a 30¢ payment absurd on them and routine here.",
  },
  {
    icon: <ShieldCheck size={13} aria-hidden />,
    title: "Neither side has to trust the other",
    body: "Funds sit in a contract while the work happens. No paying for nothing, no working for nothing, no knowing who the other party is.",
  },
];

export function WhyCardano() {
  return (
    <Panel title="Why Masumi and Cardano" subtitle="Why not just take a credit card? Three answers; the first has no workaround.">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col gap-2">
        {REASONS.map((r) => (
          <div key={r.title} className="rounded-lg border border-line bg-surface-2 px-3 py-2">
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
              <span className="text-muted">{r.icon}</span>
              {r.title}
            </p>
            <p className="mt-0.5 text-[11.5px] leading-snug text-muted">{r.body}</p>
          </div>
        ))}
        <p className="text-[11.5px] leading-snug text-ink-2">
          We did not build payment infrastructure. Masumi handles identity, escrow and settlement; we
          registered an agent and priced it.
        </p>
      </motion.div>
    </Panel>
  );
}
