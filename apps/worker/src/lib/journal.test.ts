import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Journal } from './journal.js';

/**
 * These cover the one piece of logic where a bug costs real money. Sokosumi has
 * no worker lease, so every duplicate-charge scenario has to be refused here.
 */
describe('Journal', () => {
	let dir: string;
	beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dispatch-journal-')); });
	afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

	it('claims an unseen task', () => {
		const j = new Journal(dir, 'worker-a');
		const entry = j.claim('task-1');
		expect(entry?.state).toBe('claimed');
		expect(entry?.attempts).toBe(1);
	});

	it('refuses a task another worker has claimed', () => {
		new Journal(dir, 'worker-a').claim('task-1');
		expect(new Journal(dir, 'worker-b').claim('task-1')).toBeNull();
	});

	it('refuses a completed task — the duplicate-charge case', () => {
		const j = new Journal(dir, 'worker-a');
		j.claim('task-1');
		j.advance('task-1', 'completed');
		expect(j.claim('task-1')).toBeNull();
		expect(new Journal(dir, 'worker-b').claim('task-1')).toBeNull();
	});

	it('refuses a RUNNING task even for the worker that claimed it', () => {
		// We cannot distinguish our own crash from a live second worker, and
		// guessing wrong charges the buyer twice. A human decides.
		const j = new Journal(dir, 'worker-a');
		j.claim('task-1');
		j.advance('task-1', 'running');
		expect(j.claim('task-1')).toBeNull();
	});

	it('allows retrying a failed task, and counts attempts', () => {
		const j = new Journal(dir, 'worker-a');
		j.claim('task-1');
		j.advance('task-1', 'failed', { error: 'provider timeout' });
		const again = j.claim('task-1');
		expect(again?.attempts).toBe(2);
		expect(again?.claimedAt).toBe(j.read('task-1')?.claimedAt);
	});

	it('surfaces RUNNING and repeatedly-failed tasks as stuck', () => {
		const j = new Journal(dir, 'worker-a');
		j.claim('running-task'); j.advance('running-task', 'running');
		j.claim('ok-task');      j.advance('ok-task', 'completed');
		j.claim('flaky');        j.advance('flaky', 'failed');
		j.claim('flaky');        j.advance('flaky', 'failed');

		const ids = j.stuck().map((e) => e.taskId).sort();
		expect(ids).toEqual(['flaky', 'running-task']);
	});

	it('throws rather than inventing an entry when advancing an unknown task', () => {
		expect(() => new Journal(dir, 'worker-a').advance('ghost', 'completed')).toThrow(/unjournalled/);
	});
});
