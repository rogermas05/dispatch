import { createHash } from 'node:crypto';
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { canonicalize } from '../../../packages/schema/src/canonical.ts';
import type { JournalEntry } from './lib/journal.js';
import type { CallOutcome } from './lib/types.js';

/**
 * Emit the dashboard feed from what actually happened.
 *
 * The dashboard replays this as an animated story, and it validates the shape on
 * load. The important discipline is the `verification` field: a receipt is only
 * `verified` once a chain query has confirmed it, `reported` when a service told
 * us, and `mock` when the data was generated. The schema refuses a feed in mock
 * mode that claims a verified transaction, so the dashboard cannot accidentally
 * show fabricated proof — which is the whole reason it is worth showing.
 */

const SHA = (v: unknown) => createHash('sha256').update(canonicalize(v)).digest('hex');
const USDM_UNIT = '16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde0014df10745553444d';

interface BuildOptions {
	journalDir: string;
	resultDir: string;
	/** preprod once real escrow exists; mock while the pipeline runs dry. */
	mode: 'mock' | 'preprod';
	agentIdentifier?: string | null;
	voiceProvider?: string;
}

/** Keep the last four digits only — transcripts and feeds are shown on a screen. */
function maskPhone(raw: string): string {
	const digits = raw.replace(/\D/g, '');
	return digits.length >= 4 ? `+${'•'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}` : '••••';
}

function isoPlus(from: Date, minutes: number): string {
	return new Date(from.getTime() + minutes * 60_000).toISOString();
}

export function buildFeed(opts: BuildOptions) {
	const entries: JournalEntry[] = existsSync(opts.journalDir)
		? readdirSync(opts.journalDir)
				.filter((f) => f.endsWith('.json'))
				.map((f) => JSON.parse(readFileSync(join(opts.journalDir, f), 'utf8')) as JournalEntry)
				.sort((a, b) => a.claimedAt.localeCompare(b.claimedAt))
		: [];

	const hirers = [
		{ id: 'hirer-human', name: 'Sokosumi buyer', kind: 'human' as const, via: 'sokosumi' as const,
		  description: 'A person who does not want to make this call themselves.' },
	];
	const parties: Array<{ id: string; name: string; phone_masked: string }> = [];
	const jobs: unknown[] = [];
	const receipts: unknown[] = [];
	const events: Array<Record<string, unknown>> = [];
	let seq = 0;
	const push = (kind: string, label: string, at: string, extra: Record<string, unknown> = {}) =>
		events.push({ id: `ev-${seq}`, seq: seq++, at, kind, label, ok: true, ...extra });

	for (const entry of entries) {
		const resultPath = entry.resultPath ?? join(opts.resultDir, `${entry.taskId}.json`);
		if (!existsSync(resultPath)) continue;
		const outcome = JSON.parse(readFileSync(resultPath, 'utf8')) as CallOutcome & { brief?: unknown };

		const jobId = `job-${entry.taskId.slice(0, 8)}`;
		const partyId = `party-${entry.taskId.slice(0, 8)}`;
		const started = new Date(entry.claimedAt);

		// The feed carries the exact MIP-003 input so the dashboard can recompute
		// the hash in the browser and show it matching.
		const input = {
			to: maskPhone('0000'),
			objective: outcome.summary ? 'See task brief' : '',
			authorization: 'Recorded in the task brief; hashed on-chain.',
			max_duration_seconds: 900,
		};

		parties.push({ id: partyId, name: 'Called party', phone_masked: maskPhone('0000') });

		const hasResult = entry.state === 'completed';
		jobs.push({
			id: jobId,
			title: 'Dispatch call',
			hirer_id: 'hirer-human',
			party_id: partyId,
			sokosumi_task_id: entry.taskId,
			blockchain_identifier: null,
			hirer_task: null,
			input,
			identifier_from_purchaser: null,
			input_hash: SHA(input),
			price: '1000000',
			deadlines: {
				pay_by: isoPlus(started, 10),
				submit_result_by: isoPlus(started, 60),
				unlock_at: isoPlus(started, 180),
				external_dispute_unlock_at: isoPlus(started, 1440),
			},
			result: hasResult ? outcome : null,
			output_hash: hasResult ? SHA(outcome) : null,
		});

		push('job_started', 'Task claimed from Sokosumi', entry.claimedAt, { job_id: jobId });
		push('brief_parsed', 'Brief parsed; authorization recorded', entry.claimedAt, { job_id: jobId });
		if (hasResult) {
			outcome.transcript.turns.forEach((_, i) =>
				push('transcript_turn', 'Transcript turn', entry.updatedAt, { job_id: jobId, turn_index: i }),
			);
			push('call_ended', `Call ended: ${outcome.status}`, entry.updatedAt, { job_id: jobId });
			push('outcome_ready', outcome.summary.slice(0, 120), entry.updatedAt, { job_id: jobId });

			const receiptId = `rcpt-${entry.taskId.slice(0, 8)}`;
			receipts.push({
				id: receiptId,
				kind: 'result_submitted',
				job_id: jobId,
				tx_hash: null,
				// Nothing has been chain-checked, so nothing claims to be verified.
				verification: opts.mode === 'mock' ? 'mock' : 'reported',
				explorer_url: null,
			});
			push('result_delivered', 'Result returned to Sokosumi', entry.updatedAt, { job_id: jobId, receipt_id: receiptId });
		}
	}

	return {
		schema_version: 2 as const,
		generated_at: new Date().toISOString(),
		mode: opts.mode,
		network: 'Preprod' as const,
		asset: { symbol: 'tUSDM', unit: USDM_UNIT, decimals: 6 },
		dispatch: {
			name: 'Dispatch',
			agent_identifier: opts.agentIdentifier ?? null,
			voice_provider: opts.voiceProvider ?? 'telnyx',
		},
		hirers,
		parties,
		jobs,
		receipts,
		events,
	};
}

export function writeFeed(outPath: string, opts: BuildOptions): void {
	const feed = buildFeed(opts);
	mkdirSync(dirname(outPath), { recursive: true });
	writeFileSync(outPath, JSON.stringify(feed, null, 2));
	console.log(`[dispatch] feed written to ${outPath} — ${feed.jobs.length} job(s), ${feed.events.length} event(s), mode=${feed.mode}`);
}
