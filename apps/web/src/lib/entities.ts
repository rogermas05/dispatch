// Color follows the entity everywhere on the dashboard: an agent and every
// experience it created share one hue.
import type { Feed } from "@token-origins/schema";

export const AGENT_COLORS: Record<string, string> = {
  agent_a: "var(--color-agent-a)",
  agent_b: "var(--color-agent-b)",
  agent_c: "var(--color-agent-c)",
};

export const NEUTRAL_MARK = "var(--color-neutral-mark)";
export const TOKEN_COLOR = "var(--color-token)";

export function agentColor(agentId: string | null | undefined): string {
  return (agentId && AGENT_COLORS[agentId]) || NEUTRAL_MARK;
}

export function experienceColor(feed: Feed, experienceId: string): string {
  return agentColor(feed.experiences.find((e) => e.id === experienceId)?.creator_id);
}

export function agentName(feed: Feed, agentId: string): string {
  return feed.agents.find((a) => a.id === agentId)?.name ?? agentId;
}
