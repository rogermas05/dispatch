import { describe, it, expect } from 'vitest';
import { validatePublicCall, publicCallStatus } from './public-call.js';

/**
 * This is the surface another AI reaches for, so the failure modes are
 * different: a confused caller omits fields and misreads prose. Errors have to
 * say what to send, and a missing authorization must not become an improvised one.
 */
describe('validatePublicCall', () => {
	it('accepts a minimal request', () => {
		const r = validatePublicCall({ to: '+14155550123', objective: 'Ask if the order shipped.' });
		expect(r.ok).toBe(true);
	});

	it('defaults a missing authorization to committing to nothing', () => {
		const r = validatePublicCall({ to: '+14155550123', objective: 'Ask if the order shipped.' });
		if (!r.ok) throw new Error('expected ok');
		expect(r.req.authorization).toMatch(/Gather information only/);
		expect(r.req.authorization).toMatch(/not agree to anything/);
	});

	it('rejects a non-E.164 number and says what is wanted', () => {
		const r = validatePublicCall({ to: '4155550123', objective: 'Ask if the order shipped.' });
		if (r.ok) throw new Error('expected failure');
		expect(r.errors.join()).toMatch(/E\.164/);
	});

	it('requires an objective', () => {
		const r = validatePublicCall({ to: '+14155550123' });
		if (r.ok) throw new Error('expected failure');
		expect(r.errors.join()).toMatch(/objective is required/);
	});

	it('ignores blank optional fields rather than passing empty strings along', () => {
		const r = validatePublicCall({ to: '+14155550123', objective: 'Ask something.', on_behalf_of: '   ', context: '' });
		if (!r.ok) throw new Error('expected ok');
		expect(r.req.on_behalf_of).toBeUndefined();
		expect(r.req.context).toBeUndefined();
	});
});

describe('publicCallStatus', () => {
	const deps = (status: string, extra: Record<string, unknown> = {}) => ({
		startJob: async () => ({ code: 200, payload: {} }),
		status: () => ({ code: 200, payload: { status, ...extra } }),
	});

	it('explains a failure as refunded, so the caller is not told to pay', () => {
		const r = publicCallStatus('c1', deps('failed', { error: 'unreachable' }) as never);
		expect(JSON.stringify(r.payload)).toMatch(/refunds automatically/);
	});

	it('tells a polling caller when to come back, and stops once finished', () => {
		expect((publicCallStatus('c1', deps('running') as never).payload as never as Record<string, unknown>).poll_after_seconds).toBe(30);
		expect((publicCallStatus('c1', deps('completed') as never).payload as never as Record<string, unknown>).poll_after_seconds).toBeUndefined();
	});

	it('passes through an unknown call_id rather than inventing a state', () => {
		const r = publicCallStatus('nope', { startJob: async () => ({ code: 200, payload: {} }), status: () => ({ code: 404, payload: { error: 'unknown job_id' } }) } as never);
		expect(r.code).toBe(404);
	});
});
