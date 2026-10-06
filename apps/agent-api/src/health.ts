import type { AvailabilityReport } from './types.js';

/**
 * Readiness. This gates paid work.
 *
 * The reference implementation rejected paid jobs until registration and model
 * health were confirmed, and Dispatch adds telephony to that list. Accepting a
 * job we cannot perform is worse than refusing it: funds lock before work
 * starts, so a job we fail still consumed the buyer's escrow and our
 * submitResultTime window.
 */
export interface HealthDeps {
	registrationConfirmed: () => Promise<boolean>;
	modelHealthy: () => Promise<boolean>;
	telephonyHealthy: () => Promise<boolean>;
}

export async function availability(deps: HealthDeps): Promise<AvailabilityReport> {
	const [registered, model, telephony] = await Promise.all([
		deps.registrationConfirmed().catch(() => false),
		deps.modelHealthy().catch(() => false),
		deps.telephonyHealthy().catch(() => false),
	]);

	const reasons: string[] = [];
	if (!registered) reasons.push('agent is not RegistrationConfirmed on-chain');
	if (!model) reasons.push('model provider unreachable');
	if (!telephony) reasons.push('telephony provider unhealthy — calls cannot be placed');

	return reasons.length === 0
		? { status: 'available', type: 'masumi-agent' }
		: { status: 'unavailable', type: 'masumi-agent', reasons };
}
