import { CreditCard, Coins, ShieldCheck } from "lucide-react";
import { Section, Card } from "./Section.tsx";

/**
 * The "why not just use Stripe" answer, strongest argument first.
 *
 * Micropayments are the familiar reason and the weaker one. The reason with no
 * workaround is that an agent cannot hold a card at all.
 */
export function WhyCardano() {
  return (
    <Section
      eyebrow="Why Masumi and Cardano"
      title="Why not just take a credit card?"
      lede="Three answers. The first one has no workaround."
    >
      <div className="grid gap-3 md:grid-cols-3">
        <Card icon={<CreditCard size={14} aria-hidden />} title="An agent can't hold one">
          It cannot pass KYC, cannot enter a CVV, cannot open a merchant account. When a support
          agent needs to buy one phone call at 3am there is no card to charge — there is a wallet.
        </Card>
        <Card icon={<Coins size={14} aria-hidden />} title="The amounts are tiny">
          Calls cost twenty to eighty cents. Card rails carry a fixed floor around thirty cents, so a
          thirty-cent payment is economically absurd on them. On Cardano it is routine.
        </Card>
        <Card icon={<ShieldCheck size={14} aria-hidden />} title="Neither side has to trust the other">
          Funds sit in a contract while the work happens. The buyer cannot be charged for nothing and
          the seller cannot work for nothing — without either party knowing who the other is.
        </Card>
      </div>
      <p className="mt-4 max-w-3xl text-[13px] leading-relaxed text-muted">
        We did not build payment infrastructure. Masumi handles identity, escrow and settlement; we
        registered an agent and priced it. That is the part worth noticing — a phone call became a
        fifty-cent API call because the payment rail already existed.
      </p>
    </Section>
  );
}
