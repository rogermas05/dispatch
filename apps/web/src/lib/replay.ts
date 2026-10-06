// Replays the feed's event log up to a cursor and derives what the dashboard shows
// at that moment. Pure: the playback controls only move the cursor.
import type { Feed, FeedEvent } from "@token-origins/schema";

export type JobStage =
  | "queued"
  | "searching"
  | "hired"
  | "funds_locked"
  | "dialing"
  | "on_call"
  | "outcome"
  | "committed"
  | "delivered"
  | "collected";

export interface JobProgress {
  stage: JobStage;
  turnsShown: number;
  /** Set while the job's latest event is a hold. */
  holdSeconds: number | null;
  hirerResumed: boolean;
}

export interface Snapshot {
  cursor: number;
  current: FeedEvent | null;
  activeJobId: string | null;
  registered: boolean;
  jobs: Readonly<Record<string, JobProgress>>;
  receiptIds: readonly string[];
  lockedTotal: bigint;
  collectedTotal: bigint;
  holdAbsorbedSeconds: number;
  callsCompleted: number;
  /** Hashes committed on-chain: one input hash per funded job, one output hash per submitted result. */
  commitments: number;
}

const STAGE_BY_EVENT: Partial<Record<FeedEvent["kind"], JobStage>> = {
  registry_search: "searching",
  job_started: "hired",
  funds_locked: "funds_locked",
  brief_parsed: "funds_locked",
  dialing: "dialing",
  transcript_turn: "on_call",
  on_hold: "on_call",
  call_ended: "outcome",
  outcome_ready: "outcome",
  result_submitted: "committed",
  result_delivered: "delivered",
  hirer_resumed: "delivered",
  payment_collected: "collected",
};

export function snapshotAt(feed: Feed, rawCursor: number): Snapshot {
  const cursor = Math.max(0, Math.min(feed.events.length, Math.floor(rawCursor)));
  const applied = feed.events.slice(0, cursor);
  const priceOf = new Map(feed.jobs.map((j) => [j.id, BigInt(j.price)]));

  const jobs: Record<string, JobProgress> = Object.fromEntries(
    feed.jobs.map((j) => [j.id, { stage: "queued" as JobStage, turnsShown: 0, holdSeconds: null, hirerResumed: false }]),
  );
  const receiptIds: string[] = [];
  let activeJobId: string | null = null;
  let registered = false;
  let lockedTotal = 0n;
  let collectedTotal = 0n;
  let holdAbsorbedSeconds = 0;
  let callsCompleted = 0;
  let commitments = 0;

  for (const event of applied) {
    const job = event.job_id ? jobs[event.job_id] : undefined;
    if (event.job_id && job) {
      activeJobId = event.job_id;
      jobs[event.job_id] = {
        stage: STAGE_BY_EVENT[event.kind] ?? job.stage,
        turnsShown: event.kind === "transcript_turn" ? Math.max(job.turnsShown, (event.turn_index ?? 0) + 1) : job.turnsShown,
        holdSeconds: event.kind === "on_hold" ? (event.hold_seconds ?? 0) : null,
        hirerResumed: job.hirerResumed || event.kind === "hirer_resumed",
      };
    }

    const price = (event.job_id && priceOf.get(event.job_id)) || 0n;
    switch (event.kind) {
      case "agent_registered":
        registered = true;
        break;
      case "funds_locked":
        lockedTotal += price;
        commitments += 1;
        break;
      case "result_submitted":
        commitments += 1;
        break;
      case "payment_collected":
        lockedTotal -= price;
        collectedTotal += price;
        break;
      case "on_hold":
        holdAbsorbedSeconds += event.hold_seconds ?? 0;
        break;
      case "call_ended":
        callsCompleted += 1;
        break;
      default:
        break;
    }
    if (event.receipt_id && !receiptIds.includes(event.receipt_id)) receiptIds.unshift(event.receipt_id);
  }

  return {
    cursor,
    current: applied.at(-1) ?? null,
    activeJobId,
    registered,
    jobs,
    receiptIds,
    lockedTotal,
    collectedTotal,
    holdAbsorbedSeconds,
    callsCompleted,
    commitments,
  };
}
