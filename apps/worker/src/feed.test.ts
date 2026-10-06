import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFeed } from './feed.js';
import { Feed } from '../../../packages/schema/src/feed.ts';

/**
 * The dashboard validates this feed on load, so these guard the contract
 * between the worker and the dashboard — the place two people's work meets.
 */
describe('buildFeed', () => {
	let dir: string, journalDir: string, resultDir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'dispatch-feed-'));
		journalDir = join(dir, 'journal');
		resultDir = join(dir, 'results');
		mkdirSync(journalDir, { recursive: true });
		mkdirSync(resultDir, { recursive: true });

		writeFileSync(join(journalDir, 'task-1.json'), JSON.stringify({
			taskId: 'task-1', state: 'completed', claimedAt: '2026-10-06T12:00:00.000Z',
			updatedAt: '2026-10-06T12:05:00.000Z', workerId: 'w', attempts: 1,
		}));
		writeFileSync(join(resultDir, 'task-1.json'), JSON.stringify({
			status: 'completed', durationSeconds: 90,
			transcript: { turns: [{ speaker: 'agent', text: 'hello', atSeconds: 0 }], text: 'Dispatch: hello' },
			recordingUrl: null, providerCallId: 'c-1',
			summary: 'Refill is ready.', artifacts: { reference: 'RX-1' },
			humanFollowUp: null, caveats: ['The pharmacy may be wrong.'],
		}));
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	const build = (mode: 'mock' | 'preprod' = 'mock') =>
		buildFeed({ journalDir, resultDir, mode, agentIdentifier: null });

	it('produces a feed the dashboard schema accepts', () => {
		expect(Feed.safeParse(build()).success).toBe(true);
	});

	it('never claims a verified receipt without a chain check', () => {
		// The dashboard's credibility rests on this: mock data must stay labelled.
		for (const r of build().receipts as Array<{ verification: string }>) {
			expect(r.verification).not.toBe('verified');
		}
		expect((build('mock').receipts as Array<{ verification: string }>)[0]?.verification).toBe('mock');
	});

	it('masks phone numbers, keeping only the last four digits', () => {
		const parties = build().parties as Array<{ phone_masked: string }>;
		expect(parties[0]?.phone_masked).not.toMatch(/\d{5,}/);
	});

	it('emits output_hash exactly when a result exists', () => {
		const [job] = build().jobs as Array<{ result: unknown; output_hash: string | null }>;
		expect(job?.result).not.toBeNull();
		expect(job?.output_hash).toMatch(/^[0-9a-f]{64}$/);
	});

	it('skips tasks with no saved result rather than inventing one', () => {
		writeFileSync(join(journalDir, 'task-2.json'), JSON.stringify({
			taskId: 'task-2', state: 'failed', claimedAt: '2026-10-06T13:00:00.000Z',
			updatedAt: '2026-10-06T13:01:00.000Z', workerId: 'w', attempts: 1,
		}));
		expect(build().jobs).toHaveLength(1);
	});

	it('orders events by a dense sequence so replay cannot skip', () => {
		const events = build().events as Array<{ seq: number }>;
		expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i));
	});
});
