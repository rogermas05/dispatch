import { describe, it, expect } from 'vitest';
import { __test_outcomeSchema as outcomeSchema } from './agent.js';

/**
 * Every shape here is one a model actually returned. The array case threw away
 * a completed paid call: the conversation happened, the escrow was funded, and
 * the result was discarded over the container type of a field only ever read by
 * a human. By the time this parses, the call is made and the money is locked —
 * so the rule is coerce, never throw.
 */
const base = { summary: 'done', humanFollowUp: null, caveats: [] };
const parse = (artifacts: unknown) => outcomeSchema.parse({ ...base, artifacts }).artifacts;

describe('outcome artifacts', () => {
	it('accepts a plain record', () => {
		expect(parse({ reference: 'RX-1' })).toEqual({ reference: 'RX-1' });
	});

	it('accepts name/value pairs — the shape that lost a paid call', () => {
		expect(parse([{ name: 'reference', value: 'RX-1' }, { name: 'rep', value: 'Dana' }]))
			.toEqual({ reference: 'RX-1', rep: 'Dana' });
	});

	it('accepts key/label variants', () => {
		expect(parse([{ key: 'case', value: 'C-9' }])).toEqual({ case: 'C-9' });
		expect(parse([{ label: 'ticket', text: 'T-3' }])).toEqual({ ticket: 'T-3' });
	});

	it('accepts a bare list by positional key', () => {
		expect(parse(['first', 'second'])).toEqual({ item_1: 'first', item_2: 'second' });
	});

	it('stringifies non-string values rather than rejecting them', () => {
		expect(parse({ count: 3, nested: { a: 1 } })).toEqual({ count: '3', nested: '{"a":1}' });
	});

	it('drops empty and null values', () => {
		expect(parse({ a: null, b: '', c: 'keep' })).toEqual({ c: 'keep' });
	});

	it('treats null, undefined and an empty array as no artifacts', () => {
		expect(parse(null)).toEqual({});
		expect(parse(undefined)).toEqual({});
		expect(parse([])).toEqual({});
	});

	it('never throws, whatever it is given', () => {
		for (const v of [[{}], [[1, 2]], [null], 'string', 42]) {
			expect(() => outcomeSchema.parse({ ...base, artifacts: v })).not.toThrow();
		}
	});
});
