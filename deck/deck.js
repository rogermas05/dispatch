/*
 * Dispatch deck engine.
 *
 * Every frame is a pure function of (slide, t), so the same code presents live,
 * renders 4K stills, and renders seamless video loops: the background motion is
 * built from sines whose frequencies are whole multiples of 2π / LOOP, so frame
 * LOOP equals frame 0.
 */
(() => {
	const W = 1920;
	const H = 1080;
	const LOOP = 8; // seconds; every background animation repeats exactly on this period
	const TAU = Math.PI * 2;
	const OMEGA = TAU / LOOP;
	const C = { bg: '#050607', ink: '244,241,234', us: '46,230,166', them: '255,138,82' };

	const stage = document.getElementById('stage');
	const canvas = document.getElementById('bg');
	const ctx = canvas.getContext('2d');
	const slides = [...document.querySelectorAll('section[data-slide]')];
	const status = document.getElementById('status');

	const dpr = window.devicePixelRatio || 1;
	canvas.width = W * dpr;
	canvas.height = H * dpr;
	ctx.scale(dpr, dpr);

	// Deterministic pseudo-random, so every render of a frame is identical.
	const rand = (n) => {
		const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
		return x - Math.floor(x);
	};
	const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
	const easeOut = (p) => 1 - Math.pow(1 - p, 4);

	/** A voice-like signal: a few formant-ish partials, all periodic on LOOP. */
	function voice(x, seed, t, speed = 1) {
		let v = 0;
		for (let k = 1; k <= 5; k++) {
			const f = 0.004 * k * (1 + rand(seed * 7 + k) * 1.6);
			const ph = rand(seed * 13 + k) * TAU;
			const m = Math.round(speed * (k % 3 + 1)); // whole cycles per loop
			v += Math.sin(x * f + ph + OMEGA * m * t) / k;
		}
		return v;
	}

	/* ── Backgrounds ─────────────────────────────────── */

	/** Unknown Pleasures, in Dispatch green: a mountain range of speech. */
	function ridgeline(t, { top, bottom, lines, cx, sigma, amp, rgb = C.us, alphaTop = 0.18 }) {
		const gap = (bottom - top) / (lines - 1);
		// Light bleeding up from behind the peak.
		const breathe = 0.5 + 0.5 * Math.sin(OMEGA * t);
		const glow = ctx.createRadialGradient(cx + sigma * 0.3, top + 40, 0, cx + sigma * 0.3, top + 40, sigma * 2.4);
		glow.addColorStop(0, `rgba(${rgb},${0.16 + 0.06 * breathe})`);
		glow.addColorStop(1, 'rgba(0,0,0,0)');
		ctx.fillStyle = glow;
		ctx.fillRect(0, 0, W, H);
		for (let i = 0; i < lines; i++) {
			const y0 = top + i * gap;
			const depth = i / (lines - 1);
			// The contour is stroked on its own; the fill below it hides the lines behind.
			const ridge = new Path2D();
			ridge.moveTo(0, y0);
			for (let x = 0; x <= W; x += 4) {
				const env = Math.exp(-Math.pow((x - cx) / sigma, 2)) + 0.55 * Math.exp(-Math.pow((x - cx - sigma * 0.9) / (sigma * 0.45), 2));
				const n = 0.5 + 0.5 * voice(x, i + 1, t) / 2.3;
				const jitter = 0.35 * voice(x * 3.1, i + 40, t, 2) / 2.3;
				const d = env * amp * Math.max(0, n * n + jitter * env);
				ridge.lineTo(x, y0 - d);
			}
			const body = new Path2D(ridge);
			body.lineTo(W, H);
			body.lineTo(0, H);
			body.closePath();
			ctx.fillStyle = C.bg;
			ctx.fill(body);
			ctx.lineWidth = 1.6;
			ctx.strokeStyle = `rgba(${rgb},${alphaTop + (1 - alphaTop) * depth})`;
			ctx.stroke(ridge);
		}
	}

	/** Two parties on one line: their agent in orange, ours in green, meeting in the middle. */
	function duel(t) {
		const cy = 470;
		const bars = 120;
		const span = 1680;
		const x0 = (W - span) / 2;
		const step = span / bars;
		for (let b = 0; b < bars; b++) {
			const x = x0 + b * step + step / 2;
			const left = x < W / 2;
			const fromCenter = Math.abs(x - W / 2) / (span / 2);
			const env = Math.sin(Math.PI * clamp(fromCenter * 1.02)) * 0.85 + 0.15;
			const a = Math.abs(voice(x, left ? 3 : 9, t, left ? 1 : 2)) / 2.1;
			const h = 12 + env * 150 * clamp(a * 1.25);
			const rgb = left ? C.them : C.us;
			const g = ctx.createLinearGradient(0, cy - h, 0, cy + h);
			g.addColorStop(0, `rgba(${rgb},0.15)`);
			g.addColorStop(0.5, `rgba(${rgb},1)`);
			g.addColorStop(1, `rgba(${rgb},0.15)`);
			ctx.fillStyle = g;
			const w = step * 0.42;
			roundRect(x - w / 2, cy - h, w, h * 2, w / 2);
		}
		// The handshake in the middle.
		const pulse = 0.5 + 0.5 * Math.sin(OMEGA * 2 * t);
		const glow = ctx.createRadialGradient(W / 2, cy, 0, W / 2, cy, 260);
		glow.addColorStop(0, `rgba(${C.ink},${0.1 + 0.08 * pulse})`);
		glow.addColorStop(1, 'rgba(0,0,0,0)');
		ctx.fillStyle = glow;
		ctx.fillRect(W / 2 - 260, cy - 260, 520, 520);
	}

	function roundRect(x, y, w, h, r) {
		ctx.beginPath();
		ctx.roundRect(x, y, w, h, r);
		ctx.fill();
	}

	/** Hold music: a slow, dead, repeating pulse. */
	function holdTone(t) {
		const cy = 640;
		ctx.lineWidth = 1.5;
		for (let k = 0; k < 3; k++) {
			ctx.beginPath();
			for (let x = 0; x <= W; x += 4) {
				const y = cy + k * 26 + Math.sin(x * 0.012 + OMEGA * (k + 1) * t + k) * 6 * Math.sin(x * 0.0016 + k);
				x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
			}
			ctx.strokeStyle = `rgba(${C.ink},${0.07 - k * 0.018})`;
			ctx.stroke();
		}
	}

	/** A dot grid that the escrow rail and receipts sit on. */
	function grid(rgb = C.ink, alpha = 0.06) {
		ctx.fillStyle = `rgba(${rgb},${alpha})`;
		for (let x = 120; x <= W - 120; x += 40) for (let y = 160; y <= H - 140; y += 40) ctx.fillRect(x - 1, y - 1, 2, 2);
	}

	/** The phone line along the bottom of every slide, in the colour of whoever is talking. */
	function line(t, mode) {
		const y = 978;
		const x0 = 64;
		const x1 = W - 64;
		ctx.lineWidth = 1.6;
		const seg = (from, to, rgb, seed, amp) => {
			ctx.beginPath();
			for (let x = from; x <= to; x += 3) {
				const fade = Math.sin(Math.PI * (x - from) / (to - from));
				const v = voice(x * 2.2, seed, t, 3) / 2.2;
				const yy = y + v * amp * fade * (0.6 + 0.4 * Math.abs(Math.sin(x * 0.01 + OMEGA * 2 * t)));
				x === from ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
			}
			ctx.strokeStyle = `rgba(${rgb},0.9)`;
			ctx.stroke();
		};
		if (mode === 'none') {
			ctx.fillStyle = `rgba(${C.ink},0.16)`;
			ctx.fillRect(x0, y, x1 - x0, 1.5);
		} else if (mode === 'both') {
			seg(x0, W / 2 - 8, C.them, 5, 13);
			seg(W / 2 + 8, x1, C.us, 6, 13);
		} else {
			seg(x0, x1, mode === 'them' ? C.them : C.us, mode === 'them' ? 5 : 6, 13);
		}
	}

	const BACKGROUNDS = {
		1: (t) => ridgeline(t, { top: 720, bottom: 950, lines: 30, cx: 1380, sigma: 250, amp: 230 }),
		2: (t) => holdTone(t),
		4: (t) => duel(t),
		7: () => grid(C.us, 0.05),
		9: (t) => ridgeline(t, { top: 760, bottom: 950, lines: 26, cx: 1480, sigma: 230, amp: 170, alphaTop: 0.12 }),
	};

	/* ── Slide-specific foreground ──────────────────── */

	const transcript = [
		'00:00 DISPATCH Hello, I am an AI assistant calling on behalf of a customer.',
		'00:07 THEM Cool.',
		"00:09 DISPATCH I'm Dispatch calling to confirm a paid test booking.",
		"00:17 THEM Yeah. Sure. I'm talking right now.",
		'00:19 DISPATCH Thank you for that. Have a great day! Goodbye.',
	].join('\n');
	const hashes = { orig: '…', alt: '…' };
	async function sha256(text) {
		const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
		return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
	}
	const ready = Promise.all([
		document.fonts.ready,
		sha256(transcript).then((h) => (hashes.orig = h)),
		sha256(transcript.replace("I'm talking", "I'm walking")).then((h) => (hashes.alt = h)),
	]);

	const FOREGROUND = {
		2: (t, el) => {
			const s = 7122 + Math.floor(t); // 01:58:42 and counting
			const p = (n) => String(n).padStart(2, '0');
			el.querySelector('#holdclock').textContent = `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
		},
		8: (t, el) => {
			const p = easeOut(clamp((t - 1.8) / 0.5));
			el.querySelector('.swap__a').style.opacity = String(1 - p);
			el.querySelector('.swap__b').style.opacity = String(p);
			el.querySelector('.swap').style.setProperty('--ring', String(p));
			// The hashes "compute" by resolving left to right.
			const reveal = (id, h, start) => {
				const k = Math.floor(clamp((t - start) / 0.6) * h.length);
				const noise = '0123456789abcdef';
				el.querySelector(id).textContent = h
					.split('')
					.map((c, i) => (i < k ? c : noise[Math.floor(rand(i * 31 + Math.floor(t * 20)) * 16)]) + (i === 31 ? '\n' : ''))
					.join('');
			};
			reveal('#h-orig', hashes.orig, 1.0);
			reveal('#h-alt', hashes.alt, 2.2);
		},
	};

	/* ── Render ─────────────────────────────────────── */

	function render(n, t) {
		const el = slides[n - 1];
		slides.forEach((s) => s.classList.toggle('is-active', s === el));
		const mode = el.dataset.voice;
		status.textContent = el.dataset.status;
		status.className = mode === 'them' ? 'is-them' : mode === 'none' ? 'is-muted' : '';

		for (const node of el.querySelectorAll('[data-in]')) {
			const e = easeOut(clamp((t - Number(node.dataset.in)) / 0.9));
			node.style.opacity = String(e);
			node.style.transform = `translateY(${(1 - e) * 26}px)`;
			node.style.filter = e < 1 ? `blur(${(1 - e) * 10}px)` : 'none';
		}
		FOREGROUND[n]?.(t, el);

		ctx.clearRect(0, 0, W, H);
		BACKGROUNDS[n]?.(t);
		line(t, mode);
	}

	/** When everything on a slide has finished arriving. */
	const settle = (n) => Math.max(0, ...[...slides[n - 1].querySelectorAll('[data-in]')].map((e) => Number(e.dataset.in))) + 1.4;

	window.deck = { count: slides.length, loop: LOOP, render, settle, ready };

	/* ── Live presenting ────────────────────────────── */

	if (new URLSearchParams(location.search).has('capture')) return;

	const fit = () => {
		const s = Math.min(window.innerWidth / W, window.innerHeight / H);
		stage.style.transform = `scale(${s})`;
	};
	window.addEventListener('resize', fit);
	fit();

	let current = Number(location.hash.slice(1)) || 1;
	let shownAt = performance.now();
	const demo = document.getElementById('demo');
	const video = demo.querySelector('video');
	// The demo plays in place; a click on it must not advance the deck.
	demo.addEventListener('click', (e) => {
		e.stopPropagation();
		if (video.paused) video.play();
		else video.pause();
	});
	demo.parentElement.querySelector('.s7-link').addEventListener('click', (e) => e.stopPropagation());
	video.addEventListener('play', () => demo.classList.add('is-playing'));
	video.addEventListener('pause', () => demo.classList.remove('is-playing'));

	const go = (n) => {
		current = clamp(n, 1, slides.length);
		video.pause();
		shownAt = performance.now();
		history.replaceState(null, '', `#${current}`);
	};
	window.addEventListener('keydown', (e) => {
		if (['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'Enter'].includes(e.key)) go(current + 1);
		if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) go(current - 1);
		if (e.key === 'f') document.documentElement.requestFullscreen?.();
	});
	stage.addEventListener('click', () => go(current + 1));
	ready.then(() => {
		const frame = () => {
			render(current, (performance.now() - shownAt) / 1000);
			requestAnimationFrame(frame);
		};
		frame();
	});
})();
