import { describe, it, expect } from 'vitest';
import { INPUT_SCHEMA, parseAllowlist, parseCallInput } from './input.js';

const open = { allowedNumbers: null };
const valid = {
	to: '+15550100142',
	objective: 'Find out why claim 88-20417 was denied.',
	authorization: 'May verify identity. May NOT agree to payments.',
};

describe('parseCallInput', () => {
	it('builds a brief with defaults from the minimal valid input', () => {
		const parsed = parseCallInput(valid, open);
		expect(parsed).toEqual({ ok: true, brief: { ...valid, maxDurationSeconds: 900 } });
	});

	it('carries context and accepts a duration sent as a string by form-based callers', () => {
		const parsed = parseCallInput({ ...valid, context: 'Member NW-55', max_duration_seconds: '600' }, open);
		expect(parsed.ok && parsed.brief).toMatchObject({ context: { notes: 'Member NW-55' }, maxDurationSeconds: 600 });
	});

	it('rejects a non-E.164 number', () => {
		const parsed = parseCallInput({ ...valid, to: '555-0142' }, open);
		expect(parsed.ok).toBe(false);
		expect(!parsed.ok && parsed.errors.join()).toMatch(/E\.164/);
	});

	it('refuses numbers outside the allowlist, before any escrow exists', () => {
		const parsed = parseCallInput(valid, { allowedNumbers: new Set(['+15550100187']) });
		expect(!parsed.ok && parsed.errors.join()).toMatch(/not a number Dispatch is permitted to call/);
	});

	it('requires an explicit authorization and a real objective', () => {
		const parsed = parseCallInput({ to: valid.to, objective: 'hi', authorization: '  ' }, open);
		expect(!parsed.ok && parsed.errors).toHaveLength(2);
	});

	it('rejects durations outside 60-1800 seconds and fractional seconds', () => {
		for (const d of [30, 5000, 90.5, 'abc']) {
			expect(parseCallInput({ ...valid, max_duration_seconds: d }, open).ok).toBe(false);
		}
	});

	it('rejects unknown fields rather than silently hashing them', () => {
		const parsed = parseCallInput({ ...valid, voice: 'deep' }, open);
		expect(!parsed.ok && parsed.errors.join()).toMatch(/unknown fields: voice/);
	});
});

describe('parseAllowlist', () => {
	it('parses a comma-separated list', () => {
		expect([...parseAllowlist(' +15550100142, +15550100187 ')]).toEqual(['+15550100142', '+15550100187']);
	});
	it('treats unset as empty, which callers must read as "dial nothing"', () => {
		expect(parseAllowlist(undefined).size).toBe(0);
	});
	it('fails loudly on malformed entries', () => {
		expect(() => parseAllowlist('+1555, 5550100')).toThrow(/non-E\.164/);
	});
});

describe('INPUT_SCHEMA', () => {
	const fields = INPUT_SCHEMA.input_data;
	it('uses MIP-003 Attachment 01 input types only', () => {
		const allowed = new Set(['none', 'text', 'textarea', 'number', 'tel', 'boolean', 'option', 'email', 'url']);
		for (const f of fields) expect(allowed.has(f.type)).toBe(true);
	});
	it('marks context and duration optional, everything else required', () => {
		const optional = fields.filter((f) => 'validations' in f && f.validations.some((v) => v.validation === 'optional')).map((f) => f.id);
		expect(optional).toEqual(['context', 'max_duration_seconds']);
	});
	it('tells callers that authorization is hashed on-chain', () => {
		const field = fields.find((f) => f.id === 'authorization');
		expect(field?.data.description).toMatch(/hashed on-chain/);
	});
});
