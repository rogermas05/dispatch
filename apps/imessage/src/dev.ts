import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { startSimulator, type Simulator } from './simulator.js';

/**
 * Run the iMessage bot with payments working, on one Mac, in test mode.
 *
 *   npm run imessage:dev   real iMessage through BlueBubbles Server
 *   npm run imessage:sim   a terminal chat instead, for a Mac without BlueBubbles
 *
 * Stripe needs two ways in that a laptop does not have: an https page to send
 * the payer back to, and somewhere to deliver the "paid" webhook. This opens a
 * Cloudflare quick tunnel for the first and `stripe listen` for the second,
 * using only STRIPE_SECRET_KEY, so nobody has to log the Stripe CLI in.
 */

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const APP = fileURLToPath(new URL('../', import.meta.url));
const ENV_FILE = `${ROOT}.env.local`;
const TUNNEL_TIMEOUT_MS = 30_000;
const BOT_START_TIMEOUT_MS = 60_000;
const SIM_HANDLE = '+15550000000';

const children: ChildProcess[] = [];
let simulator: Simulator | null = null;

function fail(message: string): never {
	console.error(`\n[dev] ${message}\n`);
	shutdown(1);
}

function shutdown(code: number): never {
	for (const child of children) child.kill();
	simulator?.close();
	process.exit(code);
}

async function requireBinary(name: string, install: string): Promise<void> {
	await run('which', [name]).catch(() => fail(`${name} is not installed. Install it with: ${install}`));
}

/** A Cloudflare quick tunnel to the bot. Its URL is new every run, which is fine: it is only for Stripe's redirect page. */
function openTunnel(port: number): Promise<string> {
	const tunnel = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`, '--no-autoupdate'], { stdio: ['ignore', 'ignore', 'pipe'] });
	children.push(tunnel);
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('cloudflared did not report a tunnel URL in time')), TUNNEL_TIMEOUT_MS);
		tunnel.stderr.on('data', (chunk: Buffer) => {
			const url = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(chunk.toString())?.[0];
			if (url) {
				clearTimeout(timer);
				resolve(url);
			}
		});
		tunnel.on('exit', (code) => reject(new Error(`cloudflared exited (${code})`)));
	});
}

/** Forward Stripe's test-mode webhooks to the bot. Returns the secret they are signed with. */
async function forwardStripe(apiKey: string, port: number, log: NodeJS.WritableStream): Promise<string> {
	const { stdout } = await run('stripe', ['listen', '--api-key', apiKey, '--print-secret']);
	const secret = stdout.trim();
	if (!secret.startsWith('whsec_')) fail(`stripe listen did not return a webhook secret: ${secret.slice(0, 80)}`);
	const listen = spawn('stripe', ['listen', '--api-key', apiKey, '--forward-to', `localhost:${port}/stripe/webhook`, '--events', 'checkout.session.completed'], {
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	children.push(listen);
	listen.stdout.pipe(log, { end: false });
	listen.stderr.pipe(log, { end: false });
	return secret;
}

async function waitForBot(port: number, bot: ChildProcess): Promise<void> {
	const deadline = Date.now() + BOT_START_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (bot.exitCode !== null) fail('the bot exited during startup; see the log above');
		const up = await fetch(`http://127.0.0.1:${port}/`).then((r) => r.ok).catch(() => false);
		if (up) return;
		await new Promise((r) => setTimeout(r, 500));
	}
	fail('the bot did not start listening in time');
}

async function main(): Promise<void> {
	const sim = process.argv.includes('--sim');
	if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

	const apiKey = process.env.STRIPE_SECRET_KEY?.trim();
	if (!apiKey) fail(`STRIPE_SECRET_KEY is not set. Put a Stripe sandbox secret key (sk_test_...) in ${ENV_FILE}.`);
	// This wires Stripe to a laptop through a throwaway tunnel; real money does not go through that.
	if (!apiKey.startsWith('sk_test_')) fail('STRIPE_SECRET_KEY must be a test-mode key (sk_test_...) for local runs.');
	await requireBinary('stripe', 'brew install stripe/stripe-cli/stripe');
	await requireBinary('cloudflared', 'brew install cloudflared');

	const port = Number(process.env.IMESSAGE_BOT_PORT ?? 8787);
	mkdirSync(`${ROOT}.local`, { recursive: true });
	const stripeLog = createWriteStream(`${ROOT}.local/imessage-stripe.log`, { flags: 'a' });

	const publicUrl = await openTunnel(port).catch((err: Error) => fail(err.message));
	const webhookSecret = await forwardStripe(apiKey, port, stripeLog);

	const env: NodeJS.ProcessEnv = { ...process.env, STRIPE_WEBHOOK_SECRET: webhookSecret, PAYMENTS_PUBLIC_URL: publicUrl };
	if (sim) {
		const password = randomBytes(16).toString('hex');
		const handle = process.env.IMESSAGE_SIM_HANDLE?.trim() || SIM_HANDLE;
		simulator = await startSimulator(password, handle);
		Object.assign(env, { BLUEBUBBLES_URL: simulator.url, BLUEBUBBLES_PASSWORD: password, IMESSAGE_ALLOWED_SENDERS: handle });
	}

	// In the simulator the bot's log would interleave with the chat, so it goes to a file.
	const botLogPath = `${ROOT}.local/imessage-bot.log`;
	const bot = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], { cwd: APP, env, stdio: sim ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
	children.push(bot);
	if (sim) {
		const botLog = createWriteStream(botLogPath, { flags: 'a' });
		bot.stdout?.pipe(botLog);
		bot.stderr?.pipe(botLog);
	}
	bot.on('exit', (code) => fail(`the bot exited (${code})${sim ? `; see ${botLogPath}` : ''}`));

	await waitForBot(port, bot);
	console.log(`[dev] payments page: ${publicUrl}  ·  Stripe webhooks forwarded by stripe listen (log: .local/imessage-stripe.log)`);
	console.log('[dev] pay with card 4242 4242 4242 4242, any future expiry, any CVC');
	if (simulator) {
		console.log(`[dev] bot log: ${botLogPath}`);
		simulator.chat(port);
	}
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
main().catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
