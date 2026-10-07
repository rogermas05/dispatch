import { Ledger } from './ledger.js';
import { parsePaidTopUp, StripeClient, verifySignature } from './stripe.js';

/**
 * Paying for calls over iMessage.
 *
 * The person taps a Stripe link, pays with Apple Pay, and holds a dollar balance
 * with us; each call is charged the price the Dispatch agent quotes for it. The
 * balance is prepaid credit for this service only — it cannot be withdrawn or
 * sent to anyone else.
 */

export const STRIPE_WEBHOOK_PATH = '/stripe/webhook';
export const PAID_PATH = '/paid';
export const CANCELLED_PATH = '/cancelled';

const DEFAULT_TOPUP_CENTS = 500;
/** Stripe refuses USD charges below this. */
const STRIPE_MIN_CHARGE_CENTS = 50;

export const dollars = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

/**
 * What the sender pays for a call the agent quoted at `usdm` tUSDM: one dollar
 * per tUSDM, part-cents rounded up. Throws for a quote it cannot bill, because
 * the call would otherwise go ahead unpaid.
 */
export function centsForQuote(usdm: string | null): number {
	const n = Number(usdm);
	if (usdm === null || !Number.isFinite(n) || n <= 0) throw new Error(`the agent did not quote a usable price (${usdm})`);
	// Via atomic units (6 decimals), so 0.05 is 5 cents rather than float-rounded up to 6.
	return Math.ceil(Math.round(n * 1e6) / 1e4);
}

export interface PaymentsConfig {
	stripeSecretKey: string;
	stripeWebhookSecret: string;
	/** Public https origin Stripe redirects back to and posts webhooks at. */
	publicUrl: string;
	topUpCents: number;
	ledgerFile: string;
}

function positiveCents(name: string, raw: string | undefined, fallback: number): number {
	if (!raw?.trim()) return fallback;
	const n = Number(raw);
	if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a whole number of cents, got "${raw}"`);
	return n;
}

/** Null when payments are off (no STRIPE_SECRET_KEY). Throws when they are half-configured. */
export function loadPaymentsConfig(env: NodeJS.ProcessEnv, defaultLedgerFile: string): PaymentsConfig | null {
	const stripeSecretKey = env.STRIPE_SECRET_KEY?.trim();
	if (!stripeSecretKey) return null;
	const stripeWebhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim();
	const publicUrl = env.PAYMENTS_PUBLIC_URL?.trim().replace(/\/$/, '');
	if (!stripeWebhookSecret) throw new Error('STRIPE_SECRET_KEY is set but STRIPE_WEBHOOK_SECRET is not');
	if (!publicUrl || !/^https:\/\//.test(publicUrl)) throw new Error('PAYMENTS_PUBLIC_URL must be the public https origin of this service');
	const topUpCents = positiveCents('IMESSAGE_TOPUP_CENTS', env.IMESSAGE_TOPUP_CENTS, DEFAULT_TOPUP_CENTS);
	if (topUpCents < STRIPE_MIN_CHARGE_CENTS) throw new Error(`IMESSAGE_TOPUP_CENTS must be at least ${STRIPE_MIN_CHARGE_CENTS}`);
	return {
		stripeSecretKey,
		stripeWebhookSecret,
		publicUrl,
		topUpCents,
		ledgerFile: env.IMESSAGE_LEDGER_FILE?.trim() || defaultLedgerFile,
	};
}

/** What one sender can do with their balance during one conversation turn. */
export interface Billing {
	balanceCents(): number;
	/** Take a call's quoted price. False when the balance does not cover it. */
	charge(jobKey: string, amountCents: number): boolean;
	refund(jobKey: string): void;
	/** Text a fresh payment link, in its own bubble, for at least `minCents` when the usual top-up would fall short. */
	sendTopUpLink(minCents?: number): Promise<void>;
}

export interface PaymentsDeps {
	ledger: Ledger;
	stripe: Pick<StripeClient, 'createCheckoutUrl'>;
	send: (chatGuid: string, text: string) => Promise<void>;
	now?: () => number;
}

export class Payments {
	constructor(
		private readonly cfg: Pick<PaymentsConfig, 'stripeWebhookSecret' | 'publicUrl' | 'topUpCents'>,
		private readonly deps: PaymentsDeps,
	) {}

	billingFor(handle: string, chatGuid: string): Billing {
		const { ledger, stripe, send } = this.deps;
		return {
			balanceCents: () => ledger.balance(handle),
			charge: (jobKey, amountCents) => ledger.charge(handle, amountCents, jobKey),
			refund: (jobKey) => {
				ledger.refund(handle, jobKey);
			},
			sendTopUpLink: async (minCents = 0) => {
				const url = await stripe.createCheckoutUrl({
					handle,
					chatGuid,
					amountCents: Math.max(this.cfg.topUpCents, minCents),
					successUrl: `${this.cfg.publicUrl}${PAID_PATH}`,
					cancelUrl: `${this.cfg.publicUrl}${CANCELLED_PATH}`,
				});
				await send(chatGuid, url);
			},
		};
	}

	/**
	 * Apply one Stripe webhook delivery. Returns the HTTP status to answer with:
	 * 400 only for a bad signature, so Stripe keeps retrying anything we could
	 * not store and stops retrying everything else.
	 */
	async handleWebhook(rawBody: string, signature: string | undefined): Promise<number> {
		if (!verifySignature(rawBody, signature, this.cfg.stripeWebhookSecret, (this.deps.now ?? Date.now)())) return 400;
		const topUp = parsePaidTopUp(JSON.parse(rawBody));
		if (!topUp) return 200;

		// Stripe redelivers events; the session id as the ledger reference makes a repeat a no-op.
		if (!this.deps.ledger.topUp(topUp.handle, topUp.amountCents, topUp.sessionId)) return 200;
		console.log(`[imessage] top-up ${dollars(topUp.amountCents)} for ${topUp.handle} (${topUp.sessionId})`);
		if (topUp.chatGuid) {
			// The money is recorded either way; a failed text must not make Stripe retry.
			await this.deps
				.send(topUp.chatGuid, `You're funded — ${dollars(this.deps.ledger.balance(topUp.handle))} balance. Want me to make that call?`)
				.catch((err) => console.error('[imessage] could not confirm top-up by text:', err));
		}
		return 200;
	}
}
