import type { Feed, FeedEvent } from "@token-origins/schema";
import { agentColor, TOKEN_COLOR } from "../lib/entities.ts";
import { formatAsset } from "../lib/format.ts";
import type { Snapshot } from "../lib/replay.ts";

// Fixed layout in a 760×440 viewBox. Producer rows line up with the experiences they publish.
const ROWS: Record<string, number> = { agent_a: 100, agent_b: 210, agent_c: 320 };
const PRODUCER_X = 455;
const PRODUCER_R = 25;
const EXP_X = 650;
const CUSTOMER = { x: 70, y: 210 };
const BROKER = { x: 255, y: 210, w: 132, h: 64 };
const NETWORK = { x: 560, y: 22, w: 182, h: 398 };
const ESCROW = { x: 420, y: 408 };

const PATHS = {
  task: `M${CUSTOMER.x + 52} ${CUSTOMER.y} L${BROKER.x - BROKER.w / 2} ${BROKER.y}`,
  search: `M${BROKER.x} ${BROKER.y + BROKER.h / 2} C ${BROKER.x} ${ESCROW.y}, 300 ${ESCROW.y}, 360 ${ESCROW.y} L ${NETWORK.x} ${ESCROW.y}`,
  dispatch: (y: number) =>
    `M${BROKER.x + BROKER.w / 2} ${BROKER.y} C 380 ${BROKER.y}, 380 ${y}, ${PRODUCER_X - PRODUCER_R} ${y}`,
  publish: (y: number) => `M${PRODUCER_X + PRODUCER_R} ${y} L${EXP_X - 58} ${y}`,
};

interface Motion {
  path: string;
  color: string;
  reverse?: boolean;
  radius?: number;
}

/** Which particle(s) travel for the event that just happened. */
function motionsFor(event: FeedEvent | null, feed: Feed): Motion[] {
  if (!event) return [];
  const task = feed.tasks.find((t) => t.id === event.task_id);
  const producerRow = task ? ROWS[task.producer_id] : undefined;
  const experience = feed.experiences.find((e) => e.id === event.experience_id);
  const ink = "var(--color-ink)";

  switch (event.kind) {
    case "task_received":
      return [{ path: PATHS.task, color: ink }];
    case "result_delivered":
      return [{ path: PATHS.task, color: "var(--color-good)", reverse: true }];
    case "search_completed":
      return [{ path: PATHS.search, color: ink }];
    case "order_placed":
    case "funds_locked":
      return [{ path: PATHS.search, color: TOKEN_COLOR, radius: 6 }];
    case "content_delivered":
      return [{ path: PATHS.search, color: agentColor(experience?.creator_id), reverse: true, radius: 6 }];
    case "tool_call":
      return producerRow === undefined
        ? []
        : [{ path: PATHS.dispatch(producerRow), color: event.ok ? agentColor(task?.producer_id) : "var(--color-critical)", radius: 4 }];
    case "experience_published": {
      const row = experience ? ROWS[experience.creator_id] : undefined;
      return row === undefined ? [] : [{ path: PATHS.publish(row), color: agentColor(experience?.creator_id), radius: 6 }];
    }
    case "payout_confirmed": {
      const row = event.agent_id ? ROWS[event.agent_id] : undefined;
      return row === undefined ? [] : [{ path: PATHS.publish(row), color: TOKEN_COLOR, reverse: true, radius: 7 }];
    }
    default:
      return [];
  }
}

function Particle({ path, color, reverse, radius = 5 }: Motion) {
  return (
    <circle r={radius} fill={color} stroke="var(--color-surface)" strokeWidth={2}>
      <animateMotion
        dur="0.85s"
        fill="freeze"
        path={path}
        calcMode="linear"
        keyPoints={reverse ? "1;0" : "0;1"}
        keyTimes="0;1"
      />
    </circle>
  );
}

function PulseRing({ x, y, r, color }: { x: number; y: number; r: number; color: string }) {
  return <circle className="pulse-ring" cx={x} cy={y} r={r} fill="none" stroke={color} strokeWidth={2} />;
}

interface NetworkGraphProps {
  feed: Feed;
  snapshot: Snapshot;
}

export function NetworkGraph({ feed, snapshot }: NetworkGraphProps) {
  const event = snapshot.current;
  const producers = feed.agents.filter((a) => ROWS[a.id] !== undefined);
  const storyExperiences = feed.experiences.filter((e) => !e.seeded && ROWS[e.creator_id] !== undefined);
  const workingProducer = Object.entries(snapshot.tasks).find(([, t]) => t.stage === "working")?.[0];
  const workingProducerId = feed.tasks.find((t) => t.id === workingProducer)?.producer_id;
  const brokerBusy = Object.values(snapshot.tasks).some((t) => !["queued", "published", "delivered"].includes(t.stage));
  const escrowActive = event?.kind === "funds_locked" || event?.kind === "order_placed";
  const searching = event?.kind === "search_completed";
  const chosen = event?.kind === "search_completed" ? feed.tasks.find((t) => t.id === event.task_id)?.search.chosen_experience_id : null;

  return (
    <svg viewBox="0 0 760 440" className="h-full w-full" role="img" aria-label="Network of the Sokosumi customer, Experience Broker, producer agents, escrow and published experiences">
      <defs>
        <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 L8 4 L0 8 z" fill="var(--color-muted)" />
        </marker>
      </defs>

      {/* Experience Network container */}
      <rect x={NETWORK.x} y={NETWORK.y} width={NETWORK.w} height={NETWORK.h} rx={14} fill="var(--color-surface-2)" stroke={searching ? "var(--color-ink-2)" : "var(--color-line)"} />
      <text x={NETWORK.x + 14} y={NETWORK.y + 22} fill="var(--color-ink-2)" fontSize={12} fontWeight={600}>Experience Network</text>
      <text x={NETWORK.x + 14} y={NETWORK.y + 37} fill="var(--color-muted)" fontSize={10.5}>search · storefront · lineage</text>

      {/* Edges */}
      <path d={PATHS.task} stroke="var(--color-axis)" strokeWidth={1.5} fill="none" />
      <path d={PATHS.search} stroke={escrowActive ? TOKEN_COLOR : "var(--color-axis)"} strokeWidth={1.5} fill="none" />
      {producers.map((agent) => {
        const row = ROWS[agent.id]!;
        const active = workingProducerId === agent.id;
        return (
          <g key={agent.id}>
            <path d={PATHS.dispatch(row)} stroke={active ? agentColor(agent.id) : "var(--color-axis)"} strokeWidth={active ? 2 : 1.5} fill="none" />
            <path d={PATHS.publish(row)} stroke="var(--color-axis)" strokeWidth={1.5} fill="none" />
          </g>
        );
      })}

      {/* Lineage arrows between published experiences */}
      {storyExperiences.flatMap((exp) =>
        exp.parents
          .filter((p) => snapshot.published.has(exp.id) && snapshot.published.has(p.experience_id))
          .map((p) => {
            const parent = feed.experiences.find((e) => e.id === p.experience_id);
            const fromY = ROWS[parent?.creator_id ?? ""]! + 25;
            const toY = ROWS[exp.creator_id]! - 27;
            return (
              <g key={`${p.experience_id}-${exp.id}`}>
                <line x1={EXP_X} y1={fromY} x2={EXP_X} y2={toY} stroke="var(--color-muted)" strokeWidth={1.5} markerEnd="url(#arrow)" />
                <text x={EXP_X + 8} y={(fromY + toY) / 2 + 4} fill="var(--color-muted)" fontSize={10}>builds on</text>
              </g>
            );
          }),
      )}

      {/* Customer */}
      <g>
        <rect x={CUSTOMER.x - 52} y={CUSTOMER.y - 28} width={104} height={56} rx={10} fill="var(--color-surface-2)" stroke="var(--color-line)" />
        <text x={CUSTOMER.x} y={CUSTOMER.y - 3} textAnchor="middle" fill="var(--color-ink)" fontSize={13} fontWeight={600}>Sokosumi</text>
        <text x={CUSTOMER.x} y={CUSTOMER.y + 14} textAnchor="middle" fill="var(--color-muted)" fontSize={10.5}>customer tasks</text>
      </g>

      {/* Broker */}
      <g>
        {brokerBusy && <rect className="pulse-ring" x={BROKER.x - BROKER.w / 2} y={BROKER.y - BROKER.h / 2} width={BROKER.w} height={BROKER.h} rx={12} fill="none" stroke="var(--color-ink-2)" strokeWidth={1.5} />}
        <rect x={BROKER.x - BROKER.w / 2} y={BROKER.y - BROKER.h / 2} width={BROKER.w} height={BROKER.h} rx={12} fill="var(--color-surface-2)" stroke="var(--color-ink-2)" />
        <text x={BROKER.x} y={BROKER.y - 4} textAnchor="middle" fill="var(--color-ink)" fontSize={13.5} fontWeight={600}>Experience Broker</text>
        <text x={BROKER.x} y={BROKER.y + 13} textAnchor="middle" fill="var(--color-muted)" fontSize={10.5}>
          {snapshot.registered.has("broker") ? "registered on Masumi" : "Sokosumi Coworker"}
        </text>
      </g>

      {/* Escrow */}
      <g>
        {escrowActive && <PulseRing x={ESCROW.x} y={ESCROW.y} r={16} color={TOKEN_COLOR} />}
        <rect x={ESCROW.x - 62} y={ESCROW.y - 14} width={124} height={28} rx={14} fill="var(--color-surface)" stroke={escrowActive ? TOKEN_COLOR : "var(--color-line)"} />
        <text x={ESCROW.x} y={ESCROW.y + 4} textAnchor="middle" fill="var(--color-ink-2)" fontSize={11}>Masumi escrow · Cardano</text>
      </g>

      {/* Producers */}
      {producers.map((agent) => {
        const row = ROWS[agent.id]!;
        const color = agentColor(agent.id);
        const hasWorked = feed.tasks.some((t) => t.producer_id === agent.id && snapshot.tasks[t.id]?.stage !== "queued");
        const earned = snapshot.earnedByAgent[agent.id] ?? 0n;
        return (
          <g key={agent.id} opacity={hasWorked ? 1 : 0.35} style={{ transition: "opacity 400ms" }}>
            {workingProducerId === agent.id && <PulseRing x={PRODUCER_X} y={row} r={PRODUCER_R} color={color} />}
            <circle cx={PRODUCER_X} cy={row} r={PRODUCER_R} fill={color} stroke="var(--color-surface)" strokeWidth={2} />
            <text x={PRODUCER_X} y={row + 6} textAnchor="middle" fill="#fff" fontSize={17} fontWeight={700}>{agent.name.slice(-1)}</text>
            <text x={PRODUCER_X} y={row + PRODUCER_R + 16} textAnchor="middle" fill="var(--color-ink-2)" fontSize={11}>{agent.name}</text>
            {earned > 0n && (
              <text x={PRODUCER_X} y={row + PRODUCER_R + 30} textAnchor="middle" fill="var(--color-ink)" fontSize={11} fontWeight={600}>
                +{formatAsset(earned, feed.asset.decimals)} {feed.asset.symbol}
              </text>
            )}
          </g>
        );
      })}

      {/* Experiences */}
      {storyExperiences.map((exp) => {
        const row = ROWS[exp.creator_id]!;
        const color = agentColor(exp.creator_id);
        const isPublished = snapshot.published.has(exp.id);
        const isChosen = chosen === exp.id;
        return (
          <g key={exp.id}>
            {isChosen && <rect className="pulse-ring" x={EXP_X - 58} y={row - 24} width={116} height={48} rx={10} fill="none" stroke="var(--color-ink)" strokeWidth={2} />}
            <rect
              x={EXP_X - 58}
              y={row - 24}
              width={116}
              height={48}
              rx={10}
              fill={isPublished ? `color-mix(in oklab, ${color} 22%, var(--color-surface))` : "transparent"}
              stroke={isPublished ? color : "var(--color-axis)"}
              strokeDasharray={isPublished ? undefined : "4 4"}
              strokeWidth={isPublished ? 1.5 : 1}
            />
            <text x={EXP_X} y={row - 3} textAnchor="middle" fill={isPublished ? "var(--color-ink)" : "var(--color-muted)"} fontSize={12.5} fontWeight={600} className="font-mono">
              {exp.id}
            </text>
            <text x={EXP_X} y={row + 13} textAnchor="middle" fill="var(--color-muted)" fontSize={10}>
              {isPublished ? (exp.parents.length ? `child of ${exp.parents[0]!.experience_id}` : "root experience") : "not learned yet"}
            </text>
          </g>
        );
      })}

      {/* Moving particles for the current event, restarted per event */}
      <g key={event?.id ?? "none"}>
        {motionsFor(event, feed).map((m, i) => (
          <Particle key={i} {...m} />
        ))}
      </g>
    </svg>
  );
}
