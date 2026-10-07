import { Lock, Undo2, PhoneOutgoing, FileCheck2 } from "lucide-react";
import { Section } from "./Section.tsx";

/** The escrow lifecycle, in the order it actually happens. */
const STEPS = [
  {
    icon: <Lock size={15} aria-hidden />,
    title: "Funds lock first",
    body: "The buyer locks the quoted amount in a Cardano contract before anything is dialed. Nobody has custody — not the buyer, not us, not Masumi.",
  },
  {
    icon: <PhoneOutgoing size={15} aria-hidden />,
    title: "Then the call happens",
    body: "Locked funds are the green light to dial. Dispatch navigates the menu, waits on hold, works the objective inside the authority it was granted.",
  },
  {
    icon: <FileCheck2 size={15} aria-hidden />,
    title: "The result is committed",
    body: "A hash of the request and a hash of the transcript go on-chain. Proof of what was asked and what was delivered, neither alterable afterwards.",
  },
  {
    icon: <Undo2 size={15} aria-hidden />,
    title: "Or the money comes back",
    body: "No call, no result hash — and the escrow refunds the buyer automatically when the deadline passes. Nobody pays for a call that did not happen.",
  },
];

export function HowItWorks() {
  return (
    <Section
      eyebrow="Mechanics"
      title="Pay into escrow. Get a call, or get your money back."
      lede="Four steps, and three of them are automatic. The interesting one is the last."
    >
      <div className="grid gap-3 md:grid-cols-4">
        {STEPS.map((s, i) => (
          <div key={s.title} className="rounded-xl border border-line bg-surface p-4">
            <div className="flex items-center gap-2 text-ink">
              <span className="text-muted">{s.icon}</span>
              <span className="font-mono text-[11px] text-muted">{String(i + 1).padStart(2, "0")}</span>
            </div>
            <h3 className="mt-2 text-[13px] font-semibold text-ink">{s.title}</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{s.body}</p>
          </div>
        ))}
      </div>
      <p className="mt-4 max-w-3xl text-[13px] leading-relaxed text-muted">
        None of this is visible to the person texting. They see a price, say yes, and get an answer —
        which is the point. The protocol is doing the hard part so the user does not have to know it
        exists.
      </p>
    </Section>
  );
}
