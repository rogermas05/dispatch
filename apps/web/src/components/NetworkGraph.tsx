import { Bot, Building2, Lock, Phone, User } from "lucide-react";
import { useEffect, useState } from "react";
import type { Feed, FeedEvent, Job } from "@token-origins/schema";
import { DISPATCH_COLOR, hirerColor, hirerOf, TOKEN_COLOR } from "../lib/entities.ts";
import { formatAsset } from "../lib/format.ts";
import type { Snapshot } from "../lib/replay.ts";

// Fixed layout in a 760×420 viewBox: hirers left, escrow and Dispatch centre, called parties right.
const LANES = [110, 300];
const HIRER_X = 85;
const PARTY_X = 675;
const ESCROW = { x: 285, y: 205 };
const DISPATCH = { x: 480, y: 205, r: 44 };
const LEDGER = { x: 480, y: 382 };
const REGISTRY = { x: 285, y: 38 };
const NODE_W = 150;
const NODE_H = 54;

const paths = {
  hirerToEscrow: (y: number) => `M${HIRER_X + NODE_W / 2} ${y} C 200 ${y}, 190 ${ESCROW.y}, ${ESCROW.x - 58} ${ESCROW.y}`,
  hirerToDispatch: (y: number) =>
    `M${HIRER_X + NODE_W / 2} ${y} C 200 ${y}, 190 ${ESCROW.y}, ${ESCROW.x - 58} ${ESCROW.y} L ${DISPATCH.x - DISPATCH.r} ${DISPATCH.y}`,
  escrowToDispatch: `M${ESCROW.x + 58} ${ESCROW.y} L${DISPATCH.x - DISPATCH.r} ${DISPATCH.y}`,
  dispatchToParty: (y: number) => `M${DISPATCH.x + DISPATCH.r} ${DISPATCH.y} C 570 ${DISPATCH.y}, 560 ${y}, ${PARTY_X - NODE_W / 2} ${y}`,
  dispatchToLedger: `M${DISPATCH.x} ${DISPATCH.y + DISPATCH.r} L${LEDGER.x} ${LEDGER.y - 14}`,
  hirerToRegistry: (y: number) => `M${HIRER_X} ${y - NODE_H / 2} C ${HIRER_X} 120, 150 ${REGISTRY.y}, ${REGISTRY.x - 62} ${REGISTRY.y}`,
};

interface Motion {
  path: string;
  color: string;
  reverse?: boolean;
  radius?: number;
}

function motionsFor(event: FeedEvent | null, feed: Feed, laneOf: (job: Job) => number): Motion[] {
  if (!event) return [];
  const job = feed.jobs.find((j) => j.id === event.job_id);
  const lane = job ? laneOf(job) : LANES[0]!;
  const color = hirerColor(hirerOf(feed, job));
  const hash = { path: paths.dispatchToLedger, color: "var(--color-ink)", radius: 4 };

  switch (event.kind) {
    case "agent_registered":
      return [{ ...hash, color: DISPATCH_COLOR }];
    case "registry_search":
      return [{ path: paths.hirerToRegistry(lane), color }];
    case "job_started":
      return [{ path: paths.hirerToEscrow(lane), color }];
    case "funds_locked":
      return [{ path: paths.hirerToEscrow(lane), color: TOKEN_COLOR, radius: 7 }, hash];
    case "dialing":
      return [{ path: paths.dispatchToParty(lane), color: DISPATCH_COLOR }];
    case "transcript_turn": {
      const turn = job?.result?.transcript.turns[event.turn_index ?? 0];
      return [{ path: paths.dispatchToParty(lane), color: turn?.speaker === "agent" ? DISPATCH_COLOR : "var(--color-ink-2)", reverse: turn?.speaker !== "agent", radius: 4 }];
    }
    case "result_submitted":
      return [hash];
    case "result_delivered":
      return [{ path: paths.hirerToDispatch(lane), color: DISPATCH_COLOR, reverse: true, radius: 6 }];
    case "payment_collected":
      return [{ path: paths.escrowToDispatch, color: TOKEN_COLOR, radius: 7 }];
    default:
      return [];
  }
}

function Particle({ path, color, reverse, radius = 5 }: Motion) {
  return (
    <circle r={radius} fill={color} stroke="var(--color-surface)" strokeWidth={2}>
      <animateMotion dur="0.9s" fill="freeze" path={path} calcMode="linear" keyPoints={reverse ? "1;0" : "0;1"} keyTimes="0;1" />
    </circle>
  );
}

/** Fast-forwards a hold timer so minutes of hold music play out in two seconds. */
function HoldCounter({ seconds, x, y }: { seconds: number; x: number; y: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const duration = 2200;
    const started = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const progress = Math.min(1, (now - started) / duration);
      setShown(Math.round(seconds * progress));
      if (progress < 1) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [seconds]);
  const mm = String(Math.floor(shown / 60)).padStart(2, "0");
  const ss = String(shown % 60).padStart(2, "0");
  return (
    <g>
      <rect x={x - 54} y={y - 15} width={108} height={30} rx={15} fill="var(--color-surface)" stroke="var(--color-warning)" />
      <text x={x} y={y + 5} textAnchor="middle" fill="var(--color-ink)" fontSize={12.5} fontWeight={600} className="tabular">
        On hold {mm}:{ss}
      </text>
    </g>
  );
}

function PulseRing({ x, y, r, color }: { x: number; y: number; r: number; color: string }) {
  return <circle className="pulse-ring" cx={x} cy={y} r={r} fill="none" stroke={color} strokeWidth={2} />;
}

export function NetworkGraph({ feed, snapshot }: { feed: Feed; snapshot: Snapshot }) {
  const event = snapshot.current;
  const laneOf = (job: Job) => LANES[Math.min(feed.jobs.indexOf(job), LANES.length - 1)] ?? LANES[0]!;
  const activeJob = feed.jobs.find((j) => j.id === snapshot.activeJobId);
  const onCallJob = feed.jobs.find((j) => ["dialing", "on_call"].includes(snapshot.jobs[j.id]?.stage ?? ""));
  const holdingJob = feed.jobs.find((j) => snapshot.jobs[j.id]?.holdSeconds != null);
  const escrowActive = event?.kind === "funds_locked" || event?.kind === "payment_collected";
  const searching = event?.kind === "registry_search";
  const hashing = event?.kind === "funds_locked" || event?.kind === "result_submitted" || event?.kind === "agent_registered";
  const asset = (units: bigint) => `${formatAsset(units, feed.asset.decimals)} ${feed.asset.symbol}`;

  return (
    <svg viewBox="0 0 760 420" className="h-full w-full" role="img" aria-label="Hirers pay into Masumi escrow, Dispatch places the call, and hashes of the request and transcript are committed to Cardano">
      {/* Edges */}
      <g>
      {feed.jobs.map((job) => {
        const lane = laneOf(job);
        const hirer = hirerOf(feed, job);
        const color = hirerColor(hirer);
        const live = onCallJob?.id === job.id;
        return (
          <g key={job.id}>
            <path d={paths.hirerToEscrow(lane)} fill="none" stroke={activeJob?.id === job.id ? color : "var(--color-axis)"} strokeWidth={1.5} />
            <path d={paths.dispatchToParty(lane)} fill="none" stroke="var(--color-axis)" strokeWidth={1.5} />
            {live && (
              <path d={paths.dispatchToParty(lane)} fill="none" stroke={DISPATCH_COLOR} strokeWidth={2.5} strokeDasharray="6 6" className="call-line" />
            )}
            {hirer?.kind === "agent" && (
              <path d={paths.hirerToRegistry(lane)} fill="none" stroke={searching ? color : "var(--color-line)"} strokeWidth={1.5} strokeDasharray="3 4" />
            )}
          </g>
        );
      })}
      </g>
      <path d={paths.escrowToDispatch} fill="none" stroke={escrowActive ? TOKEN_COLOR : "var(--color-axis)"} strokeWidth={1.5} />
      <path d={paths.dispatchToLedger} fill="none" stroke={hashing ? "var(--color-ink-2)" : "var(--color-axis)"} strokeWidth={1.5} />

      {/* Masumi registry */}
      <g opacity={searching ? 1 : 0.55} style={{ transition: "opacity 400ms" }}>
        {searching && <PulseRing x={REGISTRY.x} y={REGISTRY.y} r={18} color="var(--color-hirer-agent)" />}
        <rect x={REGISTRY.x - 62} y={REGISTRY.y - 15} width={124} height={30} rx={15} fill="var(--color-surface-2)" stroke="var(--color-line)" />
        <text x={REGISTRY.x} y={REGISTRY.y + 4} textAnchor="middle" fill="var(--color-ink-2)" fontSize={11}>Masumi registry</text>
      </g>

      {/* Hirers */}
      <g>
      {feed.jobs.map((job) => {
        const lane = laneOf(job);
        const hirer = hirerOf(feed, job);
        const progress = snapshot.jobs[job.id];
        const color = hirerColor(hirer);
        const Icon = hirer?.kind === "agent" ? Bot : User;
        const status = progress?.hirerResumed
          ? "task closed ✓"
          : ["delivered", "collected"].includes(progress?.stage ?? "")
            ? "result received"
            : progress && progress.stage !== "queued"
              ? hirer?.kind === "agent" ? "paused: needs a call" : "off the phone"
              : hirer?.via === "sokosumi" ? "via Sokosumi" : "AI agent via Masumi";
        return (
          <g key={job.id} opacity={progress?.stage === "queued" ? 0.45 : 1} style={{ transition: "opacity 400ms" }}>
            {(event?.kind === "hirer_resumed" || event?.kind === "job_started") && event.job_id === job.id && (
              <rect className="pulse-ring" x={HIRER_X - NODE_W / 2} y={lane - NODE_H / 2} width={NODE_W} height={NODE_H} rx={11} fill="none" stroke={color} strokeWidth={2} />
            )}
            <rect x={HIRER_X - NODE_W / 2} y={lane - NODE_H / 2} width={NODE_W} height={NODE_H} rx={11} fill="var(--color-surface-2)" stroke={color} strokeWidth={1.5} />
            <Icon x={HIRER_X - NODE_W / 2 + 11} y={lane - 9} width={18} height={18} color={color} strokeWidth={2.2} />
            <text x={HIRER_X - NODE_W / 2 + 36} y={lane - 3} fill="var(--color-ink)" fontSize={12.5} fontWeight={600}>{hirer?.name}</text>
            <text x={HIRER_X - NODE_W / 2 + 36} y={lane + 13} fill="var(--color-muted)" fontSize={10.5}>{status}</text>
          </g>
        );
      })}
      </g>

      {/* Escrow */}
      <g>
        {escrowActive && <PulseRing x={ESCROW.x} y={ESCROW.y} r={26} color={TOKEN_COLOR} />}
        <rect x={ESCROW.x - 58} y={ESCROW.y - 30} width={116} height={60} rx={12} fill="var(--color-surface-2)" stroke={escrowActive ? TOKEN_COLOR : "var(--color-line)"} strokeWidth={1.5} />
        <Lock x={ESCROW.x - 50} y={ESCROW.y - 22} width={13} height={13} color={TOKEN_COLOR} />
        <text x={ESCROW.x - 33} y={ESCROW.y - 12} fill="var(--color-ink-2)" fontSize={11} fontWeight={600}>Masumi escrow</text>
        <text x={ESCROW.x} y={ESCROW.y + 12} textAnchor="middle" fill="var(--color-ink)" fontSize={13} fontWeight={600} className="tabular">
          {asset(snapshot.lockedTotal)}
        </text>
        <text x={ESCROW.x} y={ESCROW.y + 24} textAnchor="middle" fill="var(--color-muted)" fontSize={9.5}>locked</text>
      </g>

      {/* Dispatch */}
      <g>
        {(onCallJob || event?.kind === "brief_parsed" || event?.kind === "outcome_ready") && <PulseRing x={DISPATCH.x} y={DISPATCH.y} r={DISPATCH.r} color={DISPATCH_COLOR} />}
        <circle cx={DISPATCH.x} cy={DISPATCH.y} r={DISPATCH.r} fill={DISPATCH_COLOR} stroke="var(--color-surface)" strokeWidth={3} />
        <Phone x={DISPATCH.x - 15} y={DISPATCH.y - 22} width={30} height={30} color="#fff" strokeWidth={2.2} />
        <text x={DISPATCH.x} y={DISPATCH.y + 24} textAnchor="middle" fill="#fff" fontSize={12} fontWeight={700}>{feed.dispatch.name}</text>
        <text x={DISPATCH.x} y={DISPATCH.y - DISPATCH.r - 10} textAnchor="middle" fill="var(--color-muted)" fontSize={10.5}>
          {snapshot.registered ? "registered on Masumi" : "not registered yet"}
        </text>
        {snapshot.collectedTotal > 0n && (
          <text x={DISPATCH.x} y={DISPATCH.y - DISPATCH.r - 25} textAnchor="middle" fill="var(--color-ink)" fontSize={11.5} fontWeight={600}>
            +{asset(snapshot.collectedTotal)} collected
          </text>
        )}
      </g>

      {/* Parties called */}
      <g>
      {feed.jobs.map((job) => {
        const lane = laneOf(job);
        const party = feed.parties.find((p) => p.id === job.party_id);
        const stage = snapshot.jobs[job.id]?.stage ?? "queued";
        const reached = !["queued", "searching", "hired", "funds_locked"].includes(stage);
        const ringing = stage === "dialing";
        return (
          <g key={job.id} opacity={reached ? 1 : 0.4} style={{ transition: "opacity 400ms" }}>
            {(ringing || onCallJob?.id === job.id) && (
              <rect className="pulse-ring" x={PARTY_X - NODE_W / 2} y={lane - NODE_H / 2} width={NODE_W} height={NODE_H} rx={11} fill="none" stroke={DISPATCH_COLOR} strokeWidth={2} />
            )}
            <rect x={PARTY_X - NODE_W / 2} y={lane - NODE_H / 2} width={NODE_W} height={NODE_H} rx={11} fill="var(--color-surface-2)" stroke="var(--color-line)" />
            <Building2 x={PARTY_X - NODE_W / 2 + 11} y={lane - 9} width={18} height={18} color="var(--color-ink-2)" />
            <text x={PARTY_X - NODE_W / 2 + 36} y={lane - 3} fill="var(--color-ink)" fontSize={12} fontWeight={600}>{party?.name.split(" ").slice(0, 2).join(" ")}</text>
            <text x={PARTY_X - NODE_W / 2 + 36} y={lane + 13} fill="var(--color-muted)" fontSize={10.5}>{party?.phone_masked}</text>
          </g>
        );
      })}
      </g>

      {/* Hold timer on the live call line */}
      {holdingJob && event?.kind === "on_hold" && (
        <HoldCounter key={`hold-${event.id}`} seconds={snapshot.jobs[holdingJob.id]!.holdSeconds!} x={588} y={(DISPATCH.y + laneOf(holdingJob)) / 2} />
      )}

      {/* Cardano ledger */}
      <g>
        {hashing && <PulseRing x={LEDGER.x} y={LEDGER.y} r={16} color="var(--color-ink-2)" />}
        <rect x={LEDGER.x - 92} y={LEDGER.y - 14} width={184} height={28} rx={14} fill="var(--color-surface-2)" stroke={hashing ? "var(--color-ink-2)" : "var(--color-line)"} />
        <text x={LEDGER.x} y={LEDGER.y + 4} textAnchor="middle" fill="var(--color-ink-2)" fontSize={11}>
          Cardano ledger · {snapshot.commitments} hashes
        </text>
      </g>

      <g key={`particles-${event?.id ?? "none"}`}>
        {motionsFor(event, feed, laneOf).map((m, i) => (
          <Particle key={i} {...m} />
        ))}
      </g>
    </svg>
  );
}
