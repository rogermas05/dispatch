// Packages the rendered deck as a .pptx: one full-bleed 4K still per slide, the
// living slides as looping video over that still, and the demo recording on slide 5.
//
//   node build.mjs [--demo=media/demo.mp4]
//
// Export the PDF from a build without --demo: a PDF cannot play the video, and
// LibreOffice would otherwise embed all of it. Its slide links to YouTube instead.
import pptxgen from 'pptxgenjs';
import JSZip from 'jszip';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const demo = process.argv.find((a) => a.startsWith('--demo='))?.slice(7);
const OUT = `${HERE}out/Dispatch.pptx`;
const DEMO_SLIDE = 5;
const DEMO_URL = 'https://youtu.be/5phprFxXW1w';
const CLEAR_PNG = 'image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==';
const W = 13.333;
const H = 7.5;

const NOTES = {
	1: 'This is Dispatch, a voice agent that makes phone calls for people and for other AI agents. Each call is paid for through escrow on Cardano.',
	2: "Everyone has lost an afternoon to a phone call: insurance, the pharmacy, the airline. Two hours on hold to ask one question. And more and more often, the voice on the other end is a company's bot, there to keep you waiting.",
	3: "AI agents have it worse. They can't make phone calls at all. A support agent, a claims agent or a logistics agent works fine until the next step is a phone call, and then it hands the job back to a person.",
	4: 'So we built Dispatch. You tell it who to call, what you need to find out and what it is allowed to agree to. It never goes past what you authorized, it admits it is an AI if asked, and it sends back the transcript and the answer.',
	5: `Here is the demo. Also at ${DEMO_URL}`,
	6: "People can text it over iMessage. There's nothing to install and no account: it quotes the price, sends an Apple Pay link if they need funds, makes the call and texts back the answer. If the call fails, they get their money back. Agents hire it through the Masumi API in the middle of their own task, and pay from a wallet.",
	7: 'Payment goes through Masumi escrow on Cardano. The money is locked before the phone rings and released only once the job is delivered; if nothing happens, the buyer is refunded. This has already run for real: on 7 October a program hired Dispatch, it made a 58-second call, and the registration, the result hash and the payout are all on Cardano Preprod.',
	8: 'When an AI speaks for you, you need a record of what it was told and what it said. Every paid call puts two fingerprints on Cardano. Change one letter of the transcript and it no longer matches.',
	9: "Next time you're put on hold, send Dispatch.",
};

const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE';
pres.title = 'Dispatch — Let it make the call';
pres.author = 'Roger Mas, Aman Shah';
pres.company = 'Dispatch';

const pad = (n) => String(n).padStart(2, '0');
const png = (n) => `${HERE}out/stills/slide-${pad(n)}.png`;
const cover = (n) => `image/png;base64,${readFileSync(png(n)).toString('base64')}`;

for (let n = 1; n <= Object.keys(NOTES).length; n++) {
	const slide = pres.addSlide();
	slide.background = { color: '050607' };
	slide.addImage({ path: png(n), x: 0, y: 0, w: W, h: H, altText: `Slide ${n}` });

	const loop = `${HERE}out/loops/slide-${pad(n)}.mp4`;
	if (existsSync(loop)) {
		slide.addMedia({ type: 'video', path: loop, x: 0, y: 0, w: W, h: H, cover: cover(n), objectName: `loop-${n}` });
	}
	if (n === DEMO_SLIDE && demo) {
		// The portrait frame drawn on the slide (.s7-frame): 428×760 at 746,120 of 1920×1080.
		const x = (746 / 1920) * W;
		const y = (120 / 1080) * H;
		const w = (428 / 1920) * W;
		const h = (760 / 1080) * H;
		slide.addMedia({ type: 'video', path: demo, x, y, w, h, cover: `image/png;base64,${readFileSync(`${HERE}out/stills/demo-cover.png`).toString('base64')}`, objectName: 'demo' });
	}
	if (n === DEMO_SLIDE) {
		// A clear box over the link printed under the frame (.s7-link), so it stays clickable in the .pptx and the exported PDF.
		slide.addImage({ data: CLEAR_PNG, x: (660 / 1920) * W, y: (898 / 1080) * H, w: (600 / 1920) * W, h: (40 / 1080) * H, hyperlink: { url: DEMO_URL, tooltip: 'Watch the demo' } });
	}
	slide.addNotes(NOTES[n]);
}

await pres.writeFile({ fileName: OUT });
await autoplayLoops(OUT);
console.log(`wrote ${OUT}${demo ? ` with demo ${demo}` : ' (no demo video yet: pass --demo=path)'}`);

/**
 * pptxgenjs embeds video as click-to-play. Give each background loop the timing
 * PowerPoint writes for "Start: Automatically" + "Loop until Stopped", so the
 * slide is alive the moment it appears. Without this the still cover shows, so
 * a player that ignores timing still looks right.
 */
async function autoplayLoops(file) {
	const zip = await JSZip.loadAsync(readFileSync(file));
	for (const name of Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))) {
		let xml = await zip.file(name).async('string');
		const spid = /<p:cNvPr id="(\d+)" name="loop-\d+"/.exec(xml)?.[1];
		if (!spid) continue;
		const timing =
			'<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>' +
			'<p:par><p:cTn id="2" fill="hold"><p:stCondLst><p:cond delay="indefinite"/><p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond></p:stCondLst><p:childTnLst>' +
			'<p:par><p:cTn id="3" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>' +
			'<p:par><p:cTn id="4" presetID="1" presetClass="mediacall" presetSubtype="0" fill="hold" nodeType="afterEffect"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>' +
			`<p:cmd type="call" cmd="playFrom(0.0)"><p:cBhvr><p:cTn id="5" dur="8000" fill="hold"/><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl></p:cBhvr></p:cmd>` +
			'</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>' +
			`<p:video><p:cMediaNode vol="0" mute="1"><p:cTn id="6" repeatCount="indefinite" fill="hold" display="0"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl></p:cMediaNode></p:video>` +
			'</p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>';
		xml = xml.replace('</p:clrMapOvr>', `</p:clrMapOvr>${timing}`);
		zip.file(name, xml);
	}
	writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}
