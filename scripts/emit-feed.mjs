#!/usr/bin/env node
/** Build the dashboard feed from the worker's journal and results. */
import { readFileSync, existsSync } from 'node:fs';
for (const line of existsSync('.env.local') ? readFileSync('.env.local','utf8').split('\n') : []) {
	const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
	if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g,'');
}
const { writeFeed } = await import('../apps/worker/src/feed.ts');
writeFeed(process.argv[2] ?? 'apps/web/public/mock-feed.json', {
	journalDir: '.local/journal',
	resultDir: '.local/results',
	// `|| null`, not `?? null`: an unset key in .env.local reads as an empty
	// string, which is not nullish and fails the hex digest check.
	mode: process.env.AGENT_IDENTIFIER ? 'preprod' : 'mock',
	agentIdentifier: process.env.AGENT_IDENTIFIER || null,
	voiceProvider: process.env.TELEPHONY_PROVIDER || 'telnyx',
});
