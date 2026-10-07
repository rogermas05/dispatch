import { describe, it, expect } from 'vitest';
import { __test_toTranscript as toTranscript } from './telnyx.js';

/**
 * Fixtures captured from a real Telnyx call placed on 2026-10-06 (conversation
 * e4717f03). Every field here caused a bug the first time: `content` is always
 * null so the text lives in `text`, and the API returns newest-first.
 */
const REAL_MESSAGES = [
	{ role: 'assistant', text: 'Thank you! This confirms the test call connected. Have a great day!', sent_at: '2026-10-06T11:56:40.000Z' },
	{ role: 'user', text: 'Hi, bitch.', sent_at: '2026-10-06T11:56:30.000Z' },
	{ role: 'assistant', text: 'Hello! This is Dispatch calling as a system test for a hackathon project.', sent_at: '2026-10-06T11:56:20.000Z' },
	{ role: 'user', text: 'Hello?', sent_at: '2026-10-06T11:56:10.000Z' },
	{ role: 'assistant', text: 'Hello, I am an AI assistant calling on behalf of a customer.', sent_at: '2026-10-06T11:56:00.000Z' },
];

describe('toTranscript', () => {
	it('orders turns chronologically, not as returned', () => {
		// A transcript read backwards is worse than none: it reads as a coherent
		// conversation that never happened.
		const t = toTranscript(REAL_MESSAGES);
		expect(t.turns[0]?.text).toMatch(/I am an AI assistant/);
		expect(t.turns.at(-1)?.text).toMatch(/confirms the test call connected/);
	});

	it('reads the text field, since content is always null', () => {
		const t = toTranscript([{ role: 'user', text: 'spoken', content: null, sent_at: '2026-10-06T11:56:00.000Z' } as never]);
		expect(t.turns).toHaveLength(1);
		expect(t.turns[0]?.text).toBe('spoken');
	});

	it('maps assistant to agent and everything else to the other party', () => {
		const t = toTranscript(REAL_MESSAGES);
		expect(t.turns[0]?.speaker).toBe('agent');
		expect(t.turns[1]?.speaker).toBe('other');
	});

	it('computes offsets from the first turn', () => {
		const t = toTranscript(REAL_MESSAGES);
		expect(t.turns[0]?.atSeconds).toBe(0);
		expect(t.turns.at(-1)?.atSeconds).toBe(40);
	});

	it('drops empty and null turns rather than emitting blank lines', () => {
		const t = toTranscript([
			{ role: 'user', text: null, sent_at: '2026-10-06T11:56:00.000Z' },
			{ role: 'user', text: '   ', sent_at: '2026-10-06T11:56:01.000Z' },
			{ role: 'user', text: 'real', sent_at: '2026-10-06T11:56:02.000Z' },
		]);
		expect(t.turns).toHaveLength(1);
		expect(t.text).toBe('Them: real');
	});

	it('survives an empty conversation', () => {
		expect(toTranscript([]).turns).toEqual([]);
	});
});

describe('toTranscript — machine payloads', () => {
	it('drops tool results that were recorded as conversation turns', () => {
		// Observed on a real paid call: the final "turn" was {"data":{"result":"ok"}},
		// which a transcript would otherwise attribute to the person on the phone.
		const t = toTranscript([
			{ role: 'assistant', text: 'Goodbye.', sent_at: '2026-10-07T05:26:00.000Z' },
			{ role: 'user', text: '{"data":{"result":"ok"}}', sent_at: '2026-10-07T05:26:05.000Z' },
		] as never);
		expect(t.turns).toHaveLength(1);
		expect(t.text).not.toMatch(/result/);
	});

	it('keeps speech that merely contains braces', () => {
		const t = toTranscript([
			{ role: 'user', text: 'my account is {not} a number', sent_at: '2026-10-07T05:26:00.000Z' },
		] as never);
		expect(t.turns).toHaveLength(1);
	});

	it('drops entries carrying a tool_call_id', () => {
		const t = toTranscript([
			{ role: 'user', text: 'ok', tool_call_id: 'tc-1', sent_at: '2026-10-07T05:26:00.000Z' },
			{ role: 'user', text: 'real speech', sent_at: '2026-10-07T05:26:01.000Z' },
		] as never);
		expect(t.turns).toHaveLength(1);
		expect(t.turns[0]?.text).toBe('real speech');
	});
});
