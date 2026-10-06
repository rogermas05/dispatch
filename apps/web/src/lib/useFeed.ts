import { useEffect, useState } from "react";
import { Feed } from "@token-origins/schema";

const FEED_URL = import.meta.env.VITE_FEED_URL ?? "/mock-feed.json";

export type FeedState =
  | { status: "loading" }
  | { status: "error"; message: string; issues: string[] }
  | { status: "ready"; feed: Feed };

/** Loads and validates the dashboard feed. Invalid data is shown as an error, never rendered. */
export function useFeed(): FeedState {
  const [state, setState] = useState<FeedState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(FEED_URL, { signal: controller.signal });
        if (!response.ok) throw new Error(`Feed request failed: HTTP ${response.status} from ${FEED_URL}`);
        const parsed = Feed.safeParse(await response.json());
        if (!parsed.success) {
          setState({
            status: "error",
            message: "The feed did not pass validation, so nothing is shown.",
            issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
          });
          return;
        }
        setState({ status: "ready", feed: parsed.data });
      } catch (error: unknown) {
        if (controller.signal.aborted) return;
        setState({ status: "error", message: error instanceof Error ? error.message : "Could not load the feed.", issues: [] });
      }
    })();
    return () => controller.abort();
  }, []);

  return state;
}
