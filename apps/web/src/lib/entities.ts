// Color follows the entity everywhere on the dashboard: each hirer, its jobs and
// its transcript bubbles share one hue; Dispatch has its own.
import type { Feed, Hirer, Job } from "@token-origins/schema";

export const DISPATCH_COLOR = "var(--color-dispatch)";
export const TOKEN_COLOR = "var(--color-token)";
export const NEUTRAL_MARK = "var(--color-neutral-mark)";

export function hirerColor(hirer: Pick<Hirer, "kind"> | undefined): string {
  if (!hirer) return NEUTRAL_MARK;
  return hirer.kind === "agent" ? "var(--color-hirer-agent)" : "var(--color-hirer-human)";
}

export function hirerOf(feed: Feed, job: Job | undefined): Hirer | undefined {
  return job ? feed.hirers.find((h) => h.id === job.hirer_id) : undefined;
}

export function jobColor(feed: Feed, jobId: string | null | undefined): string {
  return hirerColor(hirerOf(feed, feed.jobs.find((j) => j.id === jobId)));
}

export function partyName(feed: Feed, job: Job): string {
  return feed.parties.find((p) => p.id === job.party_id)?.name ?? job.party_id;
}
