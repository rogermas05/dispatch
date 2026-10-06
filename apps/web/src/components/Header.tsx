import { FlaskConical, Phone, Radio } from "lucide-react";
import type { Feed } from "@token-origins/schema";

export function Header({ feed }: { feed: Feed }) {
  const isMock = feed.mode === "mock";
  return (
    <header className="flex items-center justify-between gap-6">
      <div className="flex items-center gap-3">
        <Logo />
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{feed.dispatch.name}</h1>
          <p className="text-[13px] text-ink-2">A voice agent that makes phone calls for people and for other AI agents. Paid per call on Cardano.</p>
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className="rounded-full border border-line px-2.5 py-1 text-ink-2">Cardano {feed.network}</span>
        <span className="rounded-full border border-line px-2.5 py-1 text-ink-2">Masumi · Sokosumi</span>
        {isMock ? (
          <span
            className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-semibold"
            style={{ color: "var(--color-warning)", borderColor: "color-mix(in oklab, var(--color-warning) 45%, transparent)" }}
            title="Every number and transaction on this page is generated demo data"
          >
            <FlaskConical size={13} aria-hidden /> Mock data: illustrative, not on-chain
          </span>
        ) : (
          <span
            className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-semibold"
            style={{ color: "var(--color-good)", borderColor: "color-mix(in oklab, var(--color-good) 45%, transparent)" }}
          >
            <Radio size={13} aria-hidden /> Live on Preprod
          </span>
        )}
      </div>
    </header>
  );
}

function Logo() {
  return (
    <span className="grid size-[34px] place-items-center rounded-[9px] border border-line bg-surface-2" aria-hidden>
      <Phone size={17} strokeWidth={2.2} style={{ color: "var(--color-dispatch)" }} />
    </span>
  );
}
