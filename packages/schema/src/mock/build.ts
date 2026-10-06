// Builds the mock dashboard feed from the story spec. Royalty and score numbers come
// from the real policy functions, so the mock can never drift from the live math.
import { createHash } from "node:crypto";
import type { Agent, Experience, Feed, FeedEvent, Order, Receipt, RoyaltyAllocation, SearchHit, Task } from "../feed.ts";
import { allocate, DEFAULT_PLATFORM_FEE_BPS, freezeSplit, type SplitEntry } from "../royalty.ts";
import { evidenceQuality, observedSuccess, rankScore } from "../scoring.ts";
import { AGENTS, DISTRACTORS, STORY_TASKS, type StoryTaskSpec } from "./story.ts";

const STORY_START = Date.parse("2026-10-07T01:00:00Z");
const EXPERIENCE_PRICE = 1_000_000n; // 1 tUSDM at 6 decimals
const TUSDM_UNIT = "16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde0014df10745553444d";
const COLLECTION_DELAY_S = 5 * 3600; // collection waits for unlockTime, hours after purchase
const TASK_START_S = [600, 1800, 3000];

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
const mockTx = (id: string): string => sha256(`mock-tx:${id}`);
const tusdm = (units: bigint): string => (Number(units) / 1_000_000).toFixed(2);

function sortedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${sortedJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function mockReceipt(id: string, kind: Receipt["kind"]): Receipt {
  return { id, kind, tx_hash: mockTx(id), verification: "mock", explorer_url: null };
}

function seededExperience(spec: (typeof DISTRACTORS)[number]): Experience {
  const body = { problem: spec.problem, context: spec.context };
  return {
    id: spec.id,
    digest: sha256(sortedJson(body)),
    creator_id: "seed_corpus",
    task_id: null,
    seeded: true,
    problem: spec.problem,
    teaser: `Seed corpus entry: ${spec.problem.toLowerCase()}.`,
    context: spec.context,
    evidence_level: "artifact",
    parents: [],
    split: [{ recipient_id: "seed_corpus", bps: 10_000 }],
    price: EXPERIENCE_PRICE.toString(),
  };
}

function hit(experienceId: string, relevance: number, compatible: boolean, evidence: Experience["evidence_level"]): SearchHit {
  const components = {
    relevance,
    context_match: compatible ? 1 : 0,
    observed_success: observedSuccess(compatible ? 1 : 0, compatible ? 1 : 2),
    evidence_quality: evidenceQuality(evidence),
    freshness: 0.98,
    creator_reliability: 0.5,
  };
  return { experience_id: experienceId, score: Number(rankScore(components).toFixed(3)), components, compatible };
}

function storyExperience(spec: StoryTaskSpec, parent: Experience | null): Experience {
  const split: SplitEntry[] = freezeSplit(spec.producer_id, parent ? [parent.split] : []);
  const parents = parent ? [{ experience_id: parent.id, digest: parent.digest }] : [];
  const context = { api: "demo-orders", version: "1" };
  const body = { problem: spec.problem, context, parents, split, task: spec.id };
  return {
    id: spec.experience_id,
    digest: sha256(sortedJson(body)),
    creator_id: spec.producer_id,
    task_id: spec.id,
    seeded: false,
    problem: spec.problem,
    teaser: spec.teaser,
    context,
    evidence_level: "evaluator",
    parents,
    split,
    price: EXPERIENCE_PRICE.toString(),
  };
}

export function buildMockFeed(): Feed {
  const events: FeedEvent[] = [];
  const receipts: Receipt[] = [];
  const orders: Order[] = [];
  const allocations: RoyaltyAllocation[] = [];
  const tasks: Task[] = [];
  const storyExperiences: Experience[] = [];
  const distractors = DISTRACTORS.map(seededExperience);

  const emit = (atSeconds: number, kind: FeedEvent["kind"], label: string, extra: Partial<FeedEvent> = {}) => {
    const seq = events.length;
    events.push({ id: `evt_${seq}`, seq, at: new Date(STORY_START + atSeconds * 1000).toISOString(), kind, label, ok: true, ...extra });
  };

  const agents: Agent[] = AGENTS.map((a) => ({
    id: a.id,
    name: a.name,
    role: a.role,
    provider: a.provider,
    masumi_agent_identifier: a.registered ? sha256(`mock-agent:${a.id}`) : null,
  }));

  for (const agent of AGENTS.filter((a) => a.registered)) {
    const receipt = mockReceipt(`rcpt_reg_${agent.id}`, "registration");
    receipts.push(receipt);
    emit(0, "agent_registered", `${agent.name} registered on Masumi (Cardano Preprod)`, { agent_id: agent.id, receipt_id: receipt.id });
  }

  STORY_TASKS.forEach((spec, index) => {
    let t = TASK_START_S[index] ?? 0;
    const parent = storyExperiences.find((e) => e.id === spec.parent_experience_id) ?? null;
    const visible = [...distractors, ...storyExperiences];

    const hits = [
      ...distractors.map((d, i) => hit(d.id, DISTRACTORS[i]!.relevance, false, d.evidence_level)),
      ...storyExperiences.map((e) => hit(e.id, e.id === parent?.id ? 0.91 : 0.74, true, e.evidence_level)),
    ]
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    emit(t, "task_received", `Sokosumi task: ${spec.title}`, { task_id: spec.id, agent_id: "sokosumi_user" });
    const searchLabel = parent
      ? `Searched ${visible.length} experiences: ${parent.id} matches (score ${hits.find((h) => h.experience_id === parent.id)?.score.toFixed(2)})`
      : `Searched ${visible.length} experiences: no compatible match, cold start`;
    emit((t += 4), "search_completed", searchLabel, { task_id: spec.id, agent_id: "broker" });

    let order: Order | null = null;
    if (parent) {
      order = {
        id: `order_${index}`,
        buyer_id: "broker",
        task_id: spec.id,
        experience_id: parent.id,
        amount: EXPERIENCE_PRICE.toString(),
        collected_amount: null,
        platform_fee: null,
      };
      orders.push(order);
      const lock = mockReceipt(`rcpt_lock_${order.id}`, "funds_locked");
      const submit = mockReceipt(`rcpt_submit_${order.id}`, "result_submitted");
      receipts.push(lock, submit);
      emit((t += 3), "order_placed", `Broker buys ${parent.id} for ${tusdm(EXPERIENCE_PRICE)} tUSDM`, { task_id: spec.id, order_id: order.id, experience_id: parent.id, agent_id: "broker" });
      emit((t += 75), "funds_locked", "Funds locked in Masumi escrow", { order_id: order.id, receipt_id: lock.id });
      emit((t += 20), "content_delivered", `Storefront delivers ${parent.id}; output hash logged on-chain`, { order_id: order.id, experience_id: parent.id, receipt_id: submit.id, agent_id: "storefront" });
    }

    for (const call of spec.tool_calls) {
      emit((t += 6), "tool_call", call.label, { task_id: spec.id, agent_id: spec.producer_id, ok: call.ok });
    }

    const experience = storyExperience(spec, parent);
    storyExperiences.push(experience);
    emit((t += 5), "result_evaluated", spec.evaluator_label, { task_id: spec.id });
    emit((t += 2), "result_delivered", "Result returned to the Sokosumi task", { task_id: spec.id, agent_id: "broker" });
    emit((t += 20), "experience_published", `Published ${experience.id}: signed and indexed`, { task_id: spec.id, experience_id: experience.id, agent_id: spec.producer_id });

    tasks.push({
      id: spec.id,
      sokosumi_task_id: `mock-${sha256(`sokosumi:${spec.id}`).slice(0, 12)}`,
      title: spec.title,
      brief: spec.brief,
      producer_id: spec.producer_id,
      search: {
        query: spec.brief,
        hits,
        decision: parent ? "purchase" : "cold_start",
        chosen_experience_id: parent?.id ?? null,
      },
      metrics: {
        ...spec.metrics,
        tool_calls: spec.tool_calls.length,
        failed_tool_calls: spec.tool_calls.filter((c) => !c.ok).length,
      },
      baseline: spec.baseline,
      result_summary: spec.result_summary,
      published_experience_id: experience.id,
    });
  });

  // Collections land hours later, after each order's unlockTime.
  orders.forEach((order, i) => {
    const purchaseEvent = events.find((e) => e.kind === "order_placed" && e.order_id === order.id)!;
    let t = (Date.parse(purchaseEvent.at) - STORY_START) / 1000 + COLLECTION_DELAY_S;
    const sold = storyExperiences.find((e) => e.id === order.experience_id)!;
    const collected = BigInt(order.amount);
    const { fee, allocations: split } = allocate(collected, sold.split, DEFAULT_PLATFORM_FEE_BPS);
    orders[i] = { ...order, collected_amount: collected.toString(), platform_fee: fee.toString() };

    const collection = mockReceipt(`rcpt_collect_${order.id}`, "collection");
    const payout = mockReceipt(`rcpt_payout_${order.id}`, "payout");
    receipts.push(collection, payout);
    const orderAllocations = split.map((a) => ({
      id: `alloc_${order.id}_${a.recipient_id}`,
      order_id: order.id,
      recipient_id: a.recipient_id,
      amount: a.amount.toString(),
      payout_receipt_id: payout.id,
    }));
    allocations.push(...orderAllocations);

    const name = (id: string) => AGENTS.find((a) => a.id === id)?.name ?? id;
    const splitLabel = split.map((a) => `${name(a.recipient_id)} ${tusdm(a.amount)}`).join(" · ");
    emit(t, "payment_collected", `Collected ${tusdm(collected)} tUSDM for ${sold.id} after the dispute window`, { order_id: order.id, receipt_id: collection.id, agent_id: "storefront" });
    emit((t += 30), "royalty_allocated", `Split: ${splitLabel} · platform ${tusdm(fee)}`, { order_id: order.id });
    for (const alloc of orderAllocations) {
      emit((t += 1), "payout_confirmed", `Paid ${tusdm(BigInt(alloc.amount))} tUSDM to ${name(alloc.recipient_id)}`, { allocation_id: alloc.id, agent_id: alloc.recipient_id, receipt_id: payout.id });
    }
  });

  // Collections were appended after later task events; restore chronological order.
  const chronological = [...events]
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.seq - b.seq)
    .map((e, seq) => ({ ...e, id: `evt_${seq}`, seq }));

  return {
    schema_version: 1,
    generated_at: new Date(STORY_START + 12 * 3600 * 1000).toISOString(),
    mode: "mock",
    network: "Preprod",
    asset: { symbol: "tUSDM", unit: TUSDM_UNIT, decimals: 6 },
    platform_fee_bps: DEFAULT_PLATFORM_FEE_BPS,
    agents,
    tasks,
    experiences: [...storyExperiences, ...distractors],
    orders,
    allocations,
    receipts,
    events: chronological,
  };
}
