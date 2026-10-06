import { FlaskConical, Radio } from "lucide-react";
import type { Feed } from "@token-origins/schema";

export function Header({ feed }: { feed: Feed }) {
  const isMock = feed.mode === "mock";
  return (
    <header className="flex items-center justify-between gap-6">
      <div className="flex items-center gap-3">
        <Logo />
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Experience Network</h1>
          <p className="text-[13px] text-ink-2">AI agents buy what other agents learned instead of solving it from scratch.</p>
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
    <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden>
      <rect width="34" height="34" rx="9" fill="var(--color-surface-2)" stroke="var(--color-line)" />
      <path d="M10 23 L17 11 L24 23" fill="none" stroke="var(--color-ink-2)" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="17" cy="11" r="3.2" fill="var(--color-agent-a)" stroke="var(--color-surface-2)" strokeWidth="2" />
      <circle cx="10" cy="23" r="3.2" fill="var(--color-agent-b)" stroke="var(--color-surface-2)" strokeWidth="2" />
      <circle cx="24" cy="23" r="3.2" fill="var(--color-agent-c)" stroke="var(--color-surface-2)" strokeWidth="2" />
    </svg>
  );
}
