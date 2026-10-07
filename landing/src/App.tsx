import { useEffect, useState } from "react";
import { SignalCanvas } from "./gl/SignalCanvas";
import { usePrefersReducedMotion } from "./lib/hooks";
import { LINKS } from "./lib/content";
import { startScroll } from "./lib/scroll";
import { CallPlayer } from "./components/CallPlayer";
import { FinalCall } from "./components/Closing";
import { Hero } from "./components/Hero";
import { Proof } from "./components/Proof";

const ENTRANCE_DELAY_MS = 350;

/** True once the fonts have landed, so the headline never rises and then reflows. */
function useEntrance(reducedMotion: boolean): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const pause = new Promise<void>((resolve) => window.setTimeout(resolve, reducedMotion ? 0 : ENTRANCE_DELAY_MS));
    void Promise.all([pause, document.fonts.ready]).then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [reducedMotion]);
  return ready;
}

export function App() {
  const reducedMotion = usePrefersReducedMotion();
  const ready = useEntrance(reducedMotion);

  useEffect(() => startScroll(reducedMotion), [reducedMotion]);

  return (
    <div className={`app ${ready ? "is-ready" : ""}`}>
      <SignalCanvas ready={ready} reducedMotion={reducedMotion} />
      <div className="grain" aria-hidden="true" />
      <header className="nav">
        <a className="nav__name" href="#top">
          Dispatch
        </a>
        <a className="link" href={LINKS.repo} target="_blank" rel="noreferrer">
          GitHub
        </a>
      </header>
      <main>
        <Hero />
        <CallPlayer reducedMotion={reducedMotion} />
        <Proof />
        <FinalCall />
      </main>
    </div>
  );
}
