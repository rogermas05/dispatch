// Renders the deck: 4K stills of every slide, and seamless video loops of the animated ones.
import puppeteer from 'puppeteer-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HERE = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2);
const scale = Number(args.find((a) => a.startsWith('--scale='))?.slice(8) ?? 2);
const only = args.find((a) => a.startsWith('--slides='))?.slice(9).split(',').map(Number);
const loops = args.find((a) => a.startsWith('--loops='))?.slice(8).split(',').map(Number) ?? [];
const FPS = 30;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--force-color-profile=srgb', '--hide-scrollbars'] });
const page = await browser.newPage();
const open = async (dpr) => {
	await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: dpr });
	await page.goto(`file://${HERE}index.html?capture`, { waitUntil: 'networkidle0' });
	await page.evaluate(() => window.deck.ready);
};

await open(scale);
mkdirSync(`${HERE}out/stills`, { recursive: true });
const count = await page.evaluate(() => window.deck.count);
for (let n = 1; n <= count; n++) {
	if (only && !only.includes(n)) continue;
	await page.evaluate((n) => window.deck.render(n, window.deck.settle(n)), n);
	await page.screenshot({ path: `${HERE}out/stills/slide-${String(n).padStart(2, '0')}.png`, clip: { x: 0, y: 0, width: 1920, height: 1080 } });
	// The demo slide's frame on its own: the .pptx uses it as the video's cover so the slide looks the same before it plays.
	if (n === 5) await page.screenshot({ path: `${HERE}out/stills/demo-cover.png`, clip: { x: 746, y: 120, width: 428, height: 760 } });
	console.log(`still ${n}`);
}

if (loops.length) {
	await open(1);
	const loop = await page.evaluate(() => window.deck.loop);
	for (const n of loops) {
		const dir = `${HERE}out/frames-${n}`;
		rmSync(dir, { recursive: true, force: true });
		mkdirSync(dir, { recursive: true });
		const settle = await page.evaluate((n) => window.deck.settle(n), n);
		// Start after everything has arrived, so the loop only moves the living parts.
		for (let f = 0; f < loop * FPS; f++) {
			await page.evaluate((n, t) => window.deck.render(n, t), n, settle + f / FPS);
			await page.screenshot({ path: `${dir}/${String(f).padStart(4, '0')}.png`, clip: { x: 0, y: 0, width: 1920, height: 1080 } });
		}
		mkdirSync(`${HERE}out/loops`, { recursive: true });
		execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', `${dir}/%04d.png`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '16', '-preset', 'slow', '-movflags', '+faststart', `${HERE}out/loops/slide-${String(n).padStart(2, '0')}.mp4`]);
		rmSync(dir, { recursive: true, force: true });
		console.log(`loop ${n}`);
	}
}
await browser.close();
