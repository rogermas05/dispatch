import Lenis from "lenis";

/**
 * One animation loop for the whole page. Smooth scrolling, the WebGL signal and
 * every scroll-linked effect read from the same frame, so nothing drifts.
 */
export const scrollState = { y: 0, velocity: 0 };

type FrameListener = (deltaSeconds: number, nowMs: number) => void;
const listeners = new Set<FrameListener>();
let lenis: Lenis | null = null;

export function onFrame(listener: FrameListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function startScroll(reducedMotion: boolean): () => void {
  if (!reducedMotion) lenis = new Lenis({ lerp: 0.085, smoothWheel: true, anchors: true });

  let raf = 0;
  let last = performance.now();
  const tick = (now: number) => {
    lenis?.raf(now);
    const y = window.scrollY;
    scrollState.velocity = lenis ? lenis.velocity : y - scrollState.y;
    scrollState.y = y;
    const delta = Math.min(0.1, (now - last) / 1000);
    last = now;
    for (const listener of listeners) listener(delta, now);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(raf);
    lenis?.destroy();
    lenis = null;
  };
}
