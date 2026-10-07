import { useEffect, useMemo } from "react";
import type { Feed } from "@token-origins/schema";
import { Header } from "./components/Header.tsx";
import { JobPipeline } from "./components/JobPipeline.tsx";
import { Narration } from "./components/Narration.tsx";
import { NetworkGraph } from "./components/NetworkGraph.tsx";
import { Panel } from "./components/Panel.tsx";
import { PlaybackBar } from "./components/PlaybackBar.tsx";
import { OutcomePanel } from "./components/OutcomePanel.tsx";
import { ProofPanel } from "./components/ProofPanel.tsx";
import { HireDispatch } from "./components/HireDispatch.tsx";
import { ReceiptsFeed } from "./components/ReceiptsFeed.tsx";
import { StatTiles } from "./components/StatTiles.tsx";
import { TranscriptPanel } from "./components/TranscriptPanel.tsx";
import { snapshotAt } from "./lib/replay.ts";
import { useFeed } from "./lib/useFeed.ts";
import { usePlayback, type Playback } from "./lib/usePlayback.ts";

function useKeyboardShortcuts(playback: Playback) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && ["INPUT", "BUTTON", "TEXTAREA"].includes(e.target.tagName) && e.key === " ") return;
      if (e.key === " ") {
        e.preventDefault();
        playback.toggle();
      } else if (e.key === "ArrowRight") playback.step(1);
      else if (e.key === "ArrowLeft") playback.step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playback]);
}

function Dashboard({ feed }: { feed: Feed }) {
  const playback = usePlayback(feed.events);
  const snapshot = useMemo(() => snapshotAt(feed, playback.cursor), [feed, playback.cursor]);
  useKeyboardShortcuts(playback);

  return (
    <div className="mx-auto flex min-h-full max-w-[1760px] flex-col gap-3 p-5">
      <Header feed={feed} />
      <StatTiles feed={feed} snapshot={snapshot} />
      <Narration feed={feed} snapshot={snapshot} onPlay={playback.restart} />
      <div className="grid h-[460px] grid-cols-12 gap-3">
        <div className="col-span-3 flex min-h-0 min-w-0"><JobPipeline feed={feed} snapshot={snapshot} /></div>
        <Panel className="col-span-5" title="How a call moves" subtitle="Pay into escrow · Dispatch calls · hashes of the request and transcript go on-chain · collect after the dispute window">
          <NetworkGraph feed={feed} snapshot={snapshot} />
        </Panel>
        <div className="col-span-4 flex min-h-0 min-w-0"><TranscriptPanel feed={feed} snapshot={snapshot} /></div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <OutcomePanel feed={feed} snapshot={snapshot} />
        <ProofPanel feed={feed} snapshot={snapshot} />
        <ReceiptsFeed feed={feed} snapshot={snapshot} />
      </div>
      <div className="grid gap-3">
        <HireDispatch />
      </div>
      <div className="sticky bottom-3"><PlaybackBar feed={feed} playback={playback} /></div>
    </div>
  );
}

export function App() {
  const state = useFeed();
  if (state.status === "loading") {
    return <p className="p-8 text-sm text-muted">Loading feed…</p>;
  }
  if (state.status === "error") {
    return (
      <div className="m-8 max-w-2xl rounded-xl border border-line bg-surface p-5">
        <h1 className="font-semibold" style={{ color: "var(--color-critical)" }}>Could not show the dashboard</h1>
        <p className="mt-1 text-sm text-ink-2">{state.message}</p>
        {state.issues.length > 0 && (
          <ul className="mt-3 list-disc pl-5 font-mono text-xs text-muted">
            {state.issues.slice(0, 20).map((issue) => <li key={issue}>{issue}</li>)}
          </ul>
        )}
      </div>
    );
  }
  return <Dashboard feed={state.feed} />;
}
