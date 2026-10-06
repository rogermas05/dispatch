#!/usr/bin/env node
/** Phase 2T smoke test: place one real outbound call and read its transcript. */
import { readFileSync, existsSync } from 'node:fs';
for (const line of existsSync('.env.local') ? readFileSync('.env.local','utf8').split('\n') : []) {
	const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
	if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g,'');
}
const { TelnyxCallProvider } = await import('../apps/worker/src/call/telnyx.ts');

const to = process.argv[2];
if (!to) throw new Error('usage: test-call.mjs +1XXXXXXXXXX');

const provider = new TelnyxCallProvider({
	apiKey: process.env.TELNYX_API_KEY,
	fromNumber: process.env.TELNYX_FROM_NUMBER,
});
console.log('healthy:', await provider.healthy());
console.log(`calling ${to} from ${process.env.TELNYX_FROM_NUMBER} ...`);

const result = await provider.place({
	to,
	objective: 'Confirm this test call connected. Greet the person, say you are Dispatch calling as a system test for a hackathon project, ask them to say a word or two so the transcript records something, thank them and end the call.',
	authorization: 'You may only identify yourself and conduct this short test. Do not agree to anything, request anything, or discuss any other topic.',
	maxDurationSeconds: 120,
});
console.log('\n=== RESULT ===');
console.log('status   :', result.status);
console.log('duration :', result.durationSeconds, 's');
console.log('callId   :', result.providerCallId);
console.log('turns    :', result.transcript.turns.length);
console.log('\n--- transcript ---\n' + (result.transcript.text || '(empty)'));
