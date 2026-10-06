import { CircleCheck, FlaskConical, MessageSquareQuote } from "lucide-react";
import type { Verification } from "@token-origins/schema";

const STYLES: Record<Verification, { label: string; color: string; Icon: typeof CircleCheck; title: string }> = {
  verified: { label: "Verified", color: "var(--color-good)", Icon: CircleCheck, title: "Checked on-chain or measured by us" },
  reported: { label: "Reported", color: "var(--color-serious)", Icon: MessageSquareQuote, title: "A service reported this; not independently checked" },
  mock: { label: "Mock", color: "var(--color-warning)", Icon: FlaskConical, title: "Generated demo data, not a real transaction" },
};

/** Status color always ships with an icon and a label, never color alone. */
export function VerificationBadge({ verification }: { verification: Verification }) {
  const { label, color, Icon, title } = STYLES[verification];
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-semibold tracking-wide uppercase"
      style={{ color, borderColor: `color-mix(in oklab, ${color} 40%, transparent)` }}
    >
      <Icon size={11} strokeWidth={2.4} aria-hidden />
      {label}
    </span>
  );
}
