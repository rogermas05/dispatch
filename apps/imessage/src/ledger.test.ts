import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Ledger, normalizeHandle } from './ledger.js';

const HANDLE = '+14155550123';

describe('normalizeHandle', () => {
	it('treats spacing and case as the same account', () => {
		expect(normalizeHandle(' +1 415 555 0123 ')).toBe('+14155550123');
		expect(normalizeHandle('Sam@Example.com')).toBe('sam@example.com');
	});
});

describe('Ledger', () => {
	it('starts every handle at zero', () => {
		expect(new Ledger().balance(HANDLE)).toBe(0);
	});

	it('credits a top-up once, however many times it is delivered', () => {
		const ledger = new Ledger();

		expect(ledger.topUp(HANDLE, 500, 'cs_1')).toBe(true);
		expect(ledger.topUp(HANDLE, 500, 'cs_1')).toBe(false);

		expect(ledger.balance(HANDLE)).toBe(500);
	});

	it('rejects a top-up that is not a positive whole number of cents', () => {
		const ledger = new Ledger();

		expect(() => ledger.topUp(HANDLE, 0, 'cs_1')).toThrow();
		expect(() => ledger.topUp(HANDLE, 4.5, 'cs_2')).toThrow();
	});

	it('refuses a charge the balance does not cover', () => {
		const ledger = new Ledger();
		ledger.topUp(HANDLE, 40, 'cs_1');

		expect(ledger.charge(HANDLE, 50, 'job-1')).toBe(false);
		expect(ledger.balance(HANDLE)).toBe(40);
	});

	it('charges a job once and never below zero', () => {
		const ledger = new Ledger();
		ledger.topUp(HANDLE, 60, 'cs_1');

		expect(ledger.charge(HANDLE, 50, 'job-1')).toBe(true);
		expect(ledger.charge(HANDLE, 50, 'job-1')).toBe(false);
		expect(ledger.charge(HANDLE, 50, 'job-2')).toBe(false);

		expect(ledger.balance(HANDLE)).toBe(10);
	});

	it('refunds exactly what a job was charged, once', () => {
		const ledger = new Ledger();
		ledger.topUp(HANDLE, 100, 'cs_1');
		ledger.charge(HANDLE, 50, 'job-1');

		expect(ledger.refund(HANDLE, 'job-1')).toBe(true);
		expect(ledger.refund(HANDLE, 'job-1')).toBe(false);

		expect(ledger.balance(HANDLE)).toBe(100);
	});

	it('does not refund a job that was never charged, or someone else\'s', () => {
		const ledger = new Ledger();
		ledger.topUp(HANDLE, 100, 'cs_1');
		ledger.charge(HANDLE, 50, 'job-1');

		expect(ledger.refund(HANDLE, 'job-9')).toBe(false);
		expect(ledger.refund('+14155550999', 'job-1')).toBe(false);
		expect(ledger.balance('+14155550999')).toBe(0);
	});

	it('keeps balances separate per handle', () => {
		const ledger = new Ledger();
		ledger.topUp(HANDLE, 500, 'cs_1');

		expect(ledger.charge('+14155550999', 50, 'job-1')).toBe(false);
		expect(ledger.balance(HANDLE)).toBe(500);
	});

	it('survives a restart with balances and duplicate protection intact', () => {
		const file = join(mkdtempSync(join(tmpdir(), 'ledger-')), 'nested', 'ledger.jsonl');
		const first = new Ledger(file);
		first.topUp(HANDLE, 500, 'cs_1');
		first.charge(HANDLE, 50, 'job-1');

		const reopened = new Ledger(file);

		expect(reopened.balance(HANDLE)).toBe(450);
		expect(reopened.topUp(HANDLE, 500, 'cs_1')).toBe(false);
		expect(readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(2);
	});
});
