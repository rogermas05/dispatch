#!/usr/bin/env node
/**
 * Render the intro card to a real video file.
 *
 * Plays the page in a headless browser at the exact stage size and records it,
 * then transcodes to H.264 so it drops straight into CapCut, Keynote or
 * PowerPoint. Screen recording would work too; this just makes it repeatable —
 * change a line of copy and re-run rather than re-performing the capture.
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PAGE = resolve('apps/web/public/intro.html');
const OUT_DIR = '.local/render';
const DURATION_MS = 12_000;

mkdirSync(OUT_DIR, { recursive: true });
rmSync(join(OUT_DIR, 'raw'), { recursive: true, force: true });

const browser = await chromium.launch();
const context = await browser.newContext({
	viewport: { width: 1280, height: 720 },
	deviceScaleFactor: 2, // render at 2560x1440 so it stays sharp when scaled
	recordVideo: { dir: join(OUT_DIR, 'raw'), size: { width: 1280, height: 720 } },
});
const page = await context.newPage();
await page.goto(`file://${PAGE}`);
await page.waitForTimeout(DURATION_MS);
await context.close();
await browser.close();

const webm = readdirSync(join(OUT_DIR, 'raw')).find((f) => f.endsWith('.webm'));
if (!webm) throw new Error('playwright produced no recording');

const out = join(OUT_DIR, 'dispatch-intro.mp4');
execFileSync('ffmpeg', [
	'-y', '-i', join(OUT_DIR, 'raw', webm),
	'-c:v', 'libx264',
	'-preset', 'slow',
	'-crf', '18',          // visually lossless for flat colour and type
	'-pix_fmt', 'yuv420p', // required by Keynote/PowerPoint/QuickTime
	'-r', '30',
	out,
], { stdio: 'inherit' });

console.log(`\nwrote ${out}`);
