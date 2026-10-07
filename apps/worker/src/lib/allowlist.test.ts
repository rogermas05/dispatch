import { describe, it, expect, vi } from 'vitest';
import { allowlistFromEnv, NumberNotAllowedError, parseAllowlist } from './allowlist.js';

vi.mock('@anthropic-ai/sdk', () => ({
	default: class {
		messages = {
			create: async () => ({ content: [{ type: 'text', text: JSON.stringify({ to: '+15550100999', objective: 'x', authorization: 'none', maxDurationSeconds: 300 }) }] }),
		};
	},
}));

describe('allowlist', () => {
	it('is unrestricted only for the mock provider', () => {
		expect(allowlistFromEnv({})).toBeNull();
		expect(allowlistFromEnv({ TELEPHONY_PROVIDER: 'telnyx' })?.size).toBe(0);
		expect([...allowlistFromEnv({ TELEPHONY_PROVIDER: 'telnyx', DISPATCH_ALLOWED_NUMBERS: '+15550100142' })!]).toEqual(['+15550100142']);
	});

	it('fails loudly on malformed entries', () => {
		expect(() => parseAllowlist('+1555, 5550100')).toThrow(/non-E\.164/);
	});

	it('stops a Sokosumi task from dialing a number outside the list', async () => {
		process.env.ANTHROPIC_API_KEY = 'test';
		const { runBrief } = await import('../agent.js');
		const place = vi.fn();
		await expect(
			runBrief({ name: 'call', description: 'call +15550100999' }, { name: 'fake', healthy: async () => true, place }, new Set(['+15550100142'])),
		).rejects.toBeInstanceOf(NumberNotAllowedError);
		expect(place).not.toHaveBeenCalled();
	});
});
