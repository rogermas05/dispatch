import { useEffect, useMemo } from "react";
import type { Feed } from "@token-origins/schema";
import { ComparisonChart } from "./components/ComparisonChart.tsx";
import { Header } from "./components/Header.tsx";
import { Narration } from "./components/Narration.tsx";
import { NetworkGraph } from "./components/NetworkGraph.tsx";
import { Panel } from "./components/Panel.tsx";
import { PlaybackBar } from "./components/PlaybackBar.tsx";
import { ReceiptsFeed } from "./components/ReceiptsFeed.tsx";
import { RoyaltyPanel } from "./components/RoyaltyPanel.tsx";
import { SearchPanel } from "./components/SearchPanel.tsx";
import { StatTiles } from "./components/StatTiles.tsx";
import { TaskPipeline } from "./components/TaskPipeline.tsx";
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
      <div className="grid h-[440px] grid-cols-12 gap-3">
        <div className="col-span-3 flex min-h-0 min-w-0"><TaskPipeline feed={feed} snapshot={snapshot} /></div>
        <Panel className="col-span-6" title="How experience moves" subtitle="Tasks in from Sokosumi · work by producer agents · experiences published · tUSDM back to creators">
          <NetworkGraph feed={feed} snapshot={snapshot} />
        </Panel>
        <div className="col-span-3 flex min-h-0 min-w-0"><ReceiptsFeed feed={feed} snapshot={snapshot} /></div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <SearchPanel feed={feed} snapshot={snapshot} />
        <ComparisonChart feed={feed} snapshot={snapshot} />
        <RoyaltyPanel feed={feed} snapshot={snapshot} />
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
