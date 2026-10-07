import { MockCallProvider } from './mock.js';
import type { CallProvider } from './provider.js';
import { TelnyxCallProvider } from './telnyx.js';

/**
 * Pick the telephony provider from the environment. Shared by the Sokosumi
 * worker and the MIP-003 agent API so both dial the same way.
 *
 * The voice is configuration, not code: TELNYX_VOICE takes any Telnyx voice id,
 * including `elevenlabs.<model>.<voice_id>` with TELNYX_VOICE_API_KEY_REF naming
 * the Telnyx integration secret that holds the ElevenLabs key.
 */
export function selectProvider(env: NodeJS.ProcessEnv = process.env): CallProvider {
	const configured = env.TELEPHONY_PROVIDER?.trim();
	if (!configured || configured === 'mock') {
		console.warn('[dispatch] TELEPHONY_PROVIDER unset — using the mock provider. No calls will be placed.');
		return new MockCallProvider();
	}
	if (configured === 'telnyx') {
		const required = (name: string) => {
			const v = env[name];
			if (!v) throw new Error(`${name} is not set — copy .env.example to .env.local`);
			return v;
		};
		const voice = env.TELNYX_VOICE || undefined;
		if (voice?.toLowerCase().startsWith('elevenlabs.') && !env.TELNYX_VOICE_API_KEY_REF) {
			throw new Error('TELNYX_VOICE is an ElevenLabs voice but TELNYX_VOICE_API_KEY_REF is not set');
		}
		return new TelnyxCallProvider({
			apiKey: required('TELNYX_API_KEY'),
			texmlAppId: env.TELNYX_TEXML_APP_ID || undefined,
			fromNumber: required('TELNYX_FROM_NUMBER'),
			model: env.TELNYX_MODEL || undefined,
			modelApiKeyRef: env.TELNYX_MODEL_API_KEY_REF || undefined,
			voice,
			voiceApiKeyRef: env.TELNYX_VOICE_API_KEY_REF || undefined,
		});
	}
	throw new Error(`unknown TELEPHONY_PROVIDER "${configured}"`);
}
