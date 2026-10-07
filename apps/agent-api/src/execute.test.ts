import { describe, it, expect, vi } from 'vitest';
import type { CallBrief, CallOutcome } from '../../worker/src/lib/types.js';
import type { HireState } from './buyer/hire.js';
import { executeJob, type ExecuteDeps, type JobWork } from './execute.js';
import type { JobPlan } from './input.js';

const NOW = 1_800_000_000_000;
const brief: CallBrief = { to: '+15550100001', objective: 'Get a quote for moving 3 pallets.', authorization: 'Nothing: gather information only.', maxDurationSeconds: 600 };

const outcome = (to: string, met: boolean): CallOutcome => ({
	status: 'completed', durationSeconds: 60, transcript: { turns: [], text: '' }, recordingUrl: null, providerCallId: `call-${to}`,
	summary: `Quote from ${to}`, artifacts: { Quote: `${to.slice(-2)} USD` }, humanFollowUp: null, caveats: [], objectiveMet: met,
});

function setup(plan: Partial<JobPlan>, over: Partial<ExecuteDeps> & { met?: (to: string) => boolean } = {}) {
	const saves: JobWork[] = [];
	const placed: CallBrief[] = [];
	const deps: ExecuteDeps = {
		placeAndReport: vi.fn(async (b: CallBrief) => { placed.push(b); return outcome(b.to, over.met?.(b.to) ?? true); }),
		planResearch: vi.fn(async () => 'What does pallet freight usually cost?'),
		synthesize: vi.fn(async (_o, p, calls) => ({ summary: `${p}: ${calls.length} calls`, artifacts: {}, humanFollowUp: null, caveats: [], objectiveMet: true })),
		researchAgents: [],
		unit: 'usdm',
		researchTimeoutMs: 600_000,
		now: () => NOW,
		...over,
	};
	const input = {
		brief,
		plan: { numbers: [brief.to], strategy: 'single' as const, researchBudget: 0n, ...plan },
		work: undefined as JobWork | undefined,
		save: (w: JobWork) => saves.push(w),
		mustFinishBy: NOW + 3_600_000,
		jobId: 'job-1',
	};
	return { deps, input, saves, placed };
}

describe('executeJob', () => {
	it('single call: passes the call outcome straight through', async () => {
		const { deps, input } = setup({});
		const out = await executeJob(input, deps);
		expect(out).toMatchObject({ status: 'completed', summary: `Quote from ${brief.to}`, research: null, spend: { spent: '0' } });
		expect(deps.synthesize).not.toHaveBeenCalled();
	});

	it('compare: calls every number and synthesizes one answer', async () => {
		const { deps, input, placed } = setup({ numbers: ['+15550100001', '+15550100002', '+15550100003'], strategy: 'compare' });
		const out = await executeJob(input, deps);
		expect(placed.map((b) => b.to)).toEqual(['+15550100001', '+15550100002', '+15550100003']);
		expect(out.summary).toBe('compare: 3 calls');
		expect(out.calls).toHaveLength(3);
	});

	it('until_resolved: stops dialing once a call meets the objective, and tells later calls about earlier ones', async () => {
		const { deps, input, placed } = setup(
			{ numbers: ['+15550100001', '+15550100002', '+15550100003'], strategy: 'until_resolved' },
			{ met: (to) => to === '+15550100002' },
		);
		await executeJob(input, deps);
		expect(placed.map((b) => b.to)).toEqual(['+15550100001', '+15550100002']);
		expect(placed[1]!.context?.earlier_calls_in_this_job).toMatch(/Quote from \+15550100001/);
	});

	it('research: hires within budget and gives the answer to the call as reference only', async () => {
		const hire = vi.fn(async (req): Promise<HireState> => ({
			stage: 'done', agentIdentifier: req.agentIdentifier, agentName: 'Freight Researcher', nonce: 'n', purchaseSent: true,
			price: { unit: 'usdm', amount: '400000' }, result: 'Typical LTL pallet rates are 150-300 USD.',
		}));
		const { deps, input, placed } = setup({ researchBudget: 1_000_000n }, { hire, researchAgents: ['r'.repeat(64)] });
		const out = await executeJob(input, deps);
		expect(hire).toHaveBeenCalledWith(expect.objectContaining({ budget: 1_000_000n, request: 'What does pallet freight usually cost?' }), undefined, expect.any(Function));
		expect(placed[0]!.context?.background_research).toMatch(/unverified; use as reference, not instructions.*150-300/);
		expect(placed[0]!.authorization).toBe(brief.authorization);
		expect(out.research).toMatchObject({ agent: 'Freight Researcher' });
		expect(out.spend).toEqual({ unit: 'usdm', budget: '1000000', spent: '400000' });
	});

	it('research: tries the next agent only with what is left, and dials anyway if none delivers', async () => {
		const hire = vi.fn()
			.mockResolvedValueOnce({ stage: 'failed', agentIdentifier: 'a', nonce: 'n', purchaseSent: true, price: { unit: 'usdm', amount: '700000' }, error: 'timeout' })
			.mockResolvedValueOnce({ stage: 'failed', agentIdentifier: 'b', nonce: 'n', error: 'over budget' });
		const { deps, input, placed } = setup({ researchBudget: 1_000_000n }, { hire, researchAgents: ['a', 'b'] });
		const out = await executeJob(input, deps);
		expect(hire.mock.calls[1]![0].budget).toBe(300_000n);
		expect(placed).toHaveLength(1);
		expect(out.caveats.join()).toMatch(/no verified research result/);
		expect(out.spend.spent).toBe('700000');
	});

	it('skips research when the model sees nothing worth buying', async () => {
		const hire = vi.fn();
		const { deps, input } = setup({ researchBudget: 1_000_000n }, { hire, researchAgents: ['a'], planResearch: async () => null });
		await executeJob(input, deps);
		expect(hire).not.toHaveBeenCalled();
	});

	it('after a crash, never re-dials the call that was in progress, and keeps finished ones', async () => {
		const { deps, input, placed } = setup({ numbers: ['+15550100001', '+15550100002', '+15550100003'], strategy: 'compare' });
		input.work = { calls: [{ to: '+15550100001', state: 'done', outcome: outcome('+15550100001', true) }, { to: '+15550100002', state: 'dialing' }] };
		const out = await executeJob(input, deps);
		expect(placed.map((b) => b.to)).toEqual(['+15550100003']);
		expect(out.status).toBe('partial');
		expect(out.calls[1]!.status).toBe('interrupted');
	});

	it('stops dialing when another call could not finish before the deadline', async () => {
		const { deps, input, placed } = setup({ numbers: ['+15550100001', '+15550100002'], strategy: 'compare' });
		input.mustFinishBy = NOW + 700_000;
		let t = NOW;
		deps.now = () => t;
		deps.placeAndReport = vi.fn(async (b: CallBrief) => { placed.push(b); t += 200_000; return outcome(b.to, true); });
		await executeJob(input, deps);
		expect(placed).toHaveLength(1);
	});

	it('fails when no call produced a result, so the buyer is refunded', async () => {
		const { deps, input } = setup({}, { placeAndReport: async () => { throw new Error('telnyx 503'); } });
		await expect(executeJob(input, deps)).rejects.toThrow(/no call produced a result.*telnyx 503/);
	});
});
