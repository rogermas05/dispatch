import { describe, it, expect } from 'vitest';
import { masumiInputHash, masumiOutputHash } from './hash.js';

// Vectors computed independently from MIP-004's reference implementation
// (JCS-serialized input, "<identifier_from_purchaser>;" prefix, SHA-256 hex).
const nonce = 'a1b2c3d4e5f60718';
const input = {
	to: '+15550100142',
	objective: 'Find out why claim 88-20417 was denied.',
	authorization: 'May verify identity. May NOT agree to payments.',
	context: 'Member: Maya Chen — café',
	max_duration_seconds: 900,
};

describe('MIP-004 hashing', () => {
	it('hashes input as sha256(nonce;JCS(input_data))', () => {
		expect(masumiInputHash(input, nonce)).toBe('d605c158856a708cc9e84161554c73bb5a71ce887c7b12c29d528bc3dd4a0c13');
	});
	it('hashes output as sha256(nonce;output) over the raw string', () => {
		expect(masumiOutputHash('{"status":"completed","summary":"ok"}', nonce)).toBe(
			'cc4e68c47c3d7d5f262683425a7fc0442d3ec93cc6e764074b3f384e6a820227',
		);
	});
	it('binds the hash to the purchaser: same input, different nonce, different hash', () => {
		expect(masumiInputHash(input, nonce)).not.toBe(masumiInputHash(input, 'ffffffffffffffff'));
	});
});
