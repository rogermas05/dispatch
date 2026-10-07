// Builds the mock dashboard feed from the story. Input and output hashes are real
// SHA-256 over the same canonical JSON the agent API commits on-chain, so the
// dashboard's in-browser verification is genuine even though the transactions are mock.
import { createHash } from "node:crypto";
import { commitmentPreimage } from "../canonical.ts";
import type { CallOutcome, Feed, FeedEvent, Job, Receipt } from "../feed.ts";
import { HIRERS, PARTIES, STORY_JOBS, type StoryJob } from "./story.ts";

const STORY_START = Date.parse("2026-10-07T02:00:00Z");
const TUSDM_UNIT = "16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde0014df10745553444d";
const PRICES = { job_1: 1_000_000n, job_2: 500_000n } as Record<string, bigint>;
const DEFAULT_PRICE = 1_000_000n;
const MINUTE = 60;
const HOUR = 3600;

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
const hashOf = (value: unknown, nonce: string | null): string => sha256(commitmentPreimage(value, nonce));
const iso = (seconds: number): string => new Date(STORY_START + seconds * 1000).toISOString();
const mockReceipt = (id: string, kind: Receipt["kind"], jobId: string | null): Receipt => ({
  id,
  kind,
  job_id: jobId,
  tx_hash: sha256(`mock-tx:${id}`),
  verification: "mock",
  explorer_url: null,
});

function formatMinutes(seconds: number): string {
  const minutes = Math.round(seconds / MINUTE);
  return minutes >= 1 ? `${minutes} min` : `${Math.round(seconds)} s`;
}

function outcomeOf(story: StoryJob): CallOutcome {
  const { turns, ...rest } = story.result;
  return { ...rest, transcript: { turns, text: turns.map((t) => `${t.speaker}: ${t.text}`).join("\n") } };
}

export function buildMockFeed(): Feed {
  const events: Omit<FeedEvent, "id" | "seq">[] = [];
  const receipts: Receipt[] = [];
  const jobs: Job[] = [];
  const emit = (atSeconds: number, kind: FeedEvent["kind"], label: string, extra: Partial<FeedEvent> = {}) =>
    events.push({ at: iso(atSeconds), kind, label, ok: true, ...extra });

  const registration = mockReceipt("rcpt_reg_dispatch", "registration", null);
  receipts.push(registration);
  emit(0, "agent_registered", "Dispatch registered on Masumi (Cardano Preprod)", { receipt_id: registration.id });

  let t = 5 * MINUTE;
  for (const story of STORY_JOBS) {
    const hirer = HIRERS.find((h) => h.id === story.hirer_id)!;
    const party = PARTIES.find((p) => p.id === story.party_id)!;
    const result = outcomeOf(story);
    const price = PRICES[story.id] ?? DEFAULT_PRICE;
    const start = t;
    const job_id = story.id;
    // Agent hires arrive over MIP-003 with a purchaser nonce; Sokosumi tasks do not.
    const nonce = hirer.via === "masumi" ? sha256(`nonce:${job_id}`).slice(0, 20) : null;

    if (story.hirer_task) {
      emit(t, "registry_search", `${hirer.name} needs a phone call it cannot make. It searches the Masumi registry and finds Dispatch.`, { job_id });
      t += 20;
    }
    emit(t, "job_started", `${hirer.name} hires Dispatch: "${story.title}"`, { job_id });

    const lock = mockReceipt(`rcpt_lock_${job_id}`, "funds_locked", job_id);
    receipts.push(lock);
    const payer = hirer.kind === "agent" ? `from ${hirer.name}'s own wallet` : "through Sokosumi";
    emit((t += 75), "funds_locked", `${(Number(price) / 1e6).toFixed(2)} tUSDM locked in Masumi escrow ${payer}. Input hash committed.`, { job_id, receipt_id: lock.id });
    emit((t += 4), "brief_parsed", `Brief parsed. Authorization pinned: ${story.input.authorization}`, { job_id });
    emit((t += 3), "dialing", `Dialing ${party.name}`, { job_id });

    const callStart = t + 2;
    result.transcript.turns.forEach((turn, turn_index) => {
      const speaker = turn.speaker === "agent" ? "Dispatch" : party.name.split(" ")[0];
      emit(callStart + turn.atSeconds, "transcript_turn", `${speaker}: "${turn.text}"`, { job_id, turn_index });
      if (story.hold?.afterTurn === turn_index) {
        const next = result.transcript.turns[turn_index + 1];
        const hold_seconds = next ? next.atSeconds - turn.atSeconds : 0;
        const waiter = hirer.kind === "human" ? hirer.name.split(" ")[0] : "the agent";
        emit(callStart + turn.atSeconds + 1, "on_hold", `On hold for ${formatMinutes(hold_seconds)}. Dispatch waits so ${waiter} doesn't have to.`, { job_id, hold_seconds });
      }
    });

    t = callStart + result.durationSeconds;
    emit(t, "call_ended", `Call ended after ${formatMinutes(result.durationSeconds)}`, { job_id });
    emit((t += 12), "outcome_ready", `Outcome: ${result.summary}`, { job_id });

    const submit = mockReceipt(`rcpt_submit_${job_id}`, "result_submitted", job_id);
    receipts.push(submit);
    emit((t += 40), "result_submitted", "Output hash submitted on-chain: the transcript can no longer be altered", { job_id, receipt_id: submit.id });
    emit((t += 5), "result_delivered", hirer.kind === "agent" ? `Transcript and outcome returned to ${hirer.name}` : `Result returned to ${hirer.name.split(" ")[0]}'s Sokosumi task`, { job_id });
    if (story.hirer_task) {
      emit((t += 20), "hirer_resumed", `${hirer.name} resumes its own task. ${story.hirer_task.resolution}`, { job_id });
    }

    jobs.push({
      id: job_id,
      title: story.title,
      hirer_id: story.hirer_id,
      party_id: story.party_id,
      sokosumi_task_id: hirer.via === "sokosumi" ? `mock-${sha256(`sokosumi:${job_id}`).slice(0, 12)}` : null,
      blockchain_identifier: `mock-${sha256(`escrow:${job_id}`).slice(0, 24)}`,
      hirer_task: story.hirer_task,
      input: story.input,
      identifier_from_purchaser: nonce,
      input_hash: hashOf(story.input, nonce),
      price: price.toString(),
      deadlines: {
        pay_by: iso(start + 10 * MINUTE),
        submit_result_by: iso(start + 2 * HOUR),
        unlock_at: iso(start + 6 * HOUR),
        external_dispute_unlock_at: iso(start + 12 * HOUR),
      },
      result,
      output_hash: hashOf(result, nonce),
    });
    t += 10 * MINUTE;
  }

  // Collection only happens after each job's dispute window (unlockTime) closes.
  for (const job of jobs) {
    const collection = mockReceipt(`rcpt_collect_${job.id}`, "collection", job.id);
    receipts.push(collection);
    const at = (Date.parse(job.deadlines.unlock_at) - STORY_START) / 1000 + 2 * MINUTE;
    emit(at, "payment_collected", `Dispute window closed. Dispatch collects ${(Number(job.price) / 1e6).toFixed(2)} tUSDM for "${job.title}"`, { job_id: job.id, receipt_id: collection.id });
  }

  const ordered = events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => Date.parse(a.e.at) - Date.parse(b.e.at) || a.i - b.i)
    .map(({ e }, seq) => ({ ...e, id: `evt_${seq}`, seq }));

  return {
    schema_version: 2,
    generated_at: iso(14 * HOUR),
    mode: "mock",
    network: "Preprod",
    asset: { symbol: "tUSDM", unit: TUSDM_UNIT, decimals: 6 },
    dispatch: { name: "Dispatch", agent_identifier: sha256("mock-agent:dispatch"), voice_provider: "Telnyx (mock)" },
    hirers: HIRERS,
    parties: PARTIES,
    jobs,
    receipts,
    events: ordered,
  };
}
