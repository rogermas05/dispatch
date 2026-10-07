import { describe, it, expect } from 'vitest';
import { selectProvider } from './select.js';

describe('selectProvider', () => {
	it('falls back to the mock provider when unset', () => {
		expect(selectProvider({}).name).toBe('mock');
	});
	it('builds Telnyx with an ElevenLabs voice when the key ref is present', () => {
		const p = selectProvider({
			TELEPHONY_PROVIDER: 'telnyx', TELNYX_API_KEY: 'k', TELNYX_FROM_NUMBER: '+15550100100',
			TELNYX_VOICE: 'elevenlabs.eleven_turbo_v2_5.abc', TELNYX_VOICE_API_KEY_REF: 'elevenlabs-key',
		});
		expect(p.name).toBe('telnyx');
	});
	it('refuses an ElevenLabs voice without the key ref instead of silently using a default voice', () => {
		expect(() => selectProvider({
			TELEPHONY_PROVIDER: 'telnyx', TELNYX_API_KEY: 'k', TELNYX_FROM_NUMBER: '+15550100100',
			TELNYX_VOICE: 'elevenlabs.eleven_turbo_v2_5.abc',
		})).toThrow(/TELNYX_VOICE_API_KEY_REF/);
	});
	it('rejects unknown providers', () => {
		expect(() => selectProvider({ TELEPHONY_PROVIDER: 'carrier-pigeon' })).toThrow(/unknown/);
	});
});
