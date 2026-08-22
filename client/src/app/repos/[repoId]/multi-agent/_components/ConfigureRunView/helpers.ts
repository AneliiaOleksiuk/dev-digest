/* ConfigureRunView/helpers.ts — pure, unit-testable estimate math (WI11).
   No React/DOM here so it can be exercised directly from a plain Vitest file. */
import type { AgentCostEstimate } from "@/lib/hooks/multi-agent";

export interface SelectionEstimate {
  /** Sum of each selected agent's `avg_cost_usd` (agents with no data are
   *  skipped, never treated as $0 — OQ-6). Null when nobody has cost data. */
  totalCostUsd: number | null;
  /** True when at least one selected agent has cost data but at least one
   *  other selected agent doesn't — mirrors `MultiAgentRun.total_cost_partial`
   *  (OQ-1: badge the estimate as partial, never silently under-count). */
  costPartial: boolean;
  /** MAXIMUM of the selected agents' `avg_duration_ms` — a parallel batch's
   *  wall-clock is roughly the slowest agent, not the sum of all of them. */
  maxDurationMs: number | null;
  /** False only when NONE of the selected agents have any stats yet — the
   *  caller renders "no estimate yet" rather than a fabricated number. */
  hasAnyEstimate: boolean;
}

/** Roll up a selection of agent ids into one estimate, using each agent's
 *  OWN historical stats (already scoped server-side to its current model,
 *  OQ-6) — an agent absent from `stats` (never run) contributes nothing,
 *  the same as one present with null averages. */
export function computeSelectionEstimate(
  stats: AgentCostEstimate[],
  selectedAgentIds: string[],
): SelectionEstimate {
  const byId = new Map(stats.map((s) => [s.agent_id, s]));
  const picked = selectedAgentIds.map((id) => byId.get(id) ?? null);
  const knownCosts = picked
    .map((s) => s?.avg_cost_usd ?? null)
    .filter((c): c is number => c != null);
  const knownDurations = picked
    .map((s) => s?.avg_duration_ms ?? null)
    .filter((d): d is number => d != null);

  return {
    totalCostUsd: knownCosts.length > 0 ? knownCosts.reduce((a, b) => a + b, 0) : null,
    costPartial: knownCosts.length > 0 && knownCosts.length < selectedAgentIds.length,
    maxDurationMs: knownDurations.length > 0 ? Math.max(...knownDurations) : null,
    hasAnyEstimate: knownCosts.length > 0 || knownDurations.length > 0,
  };
}

/** Per-agent-card estimate: this agent's OWN avg duration/cost + sample size,
 *  or null when it has no completed runs under its current model yet. */
export interface AgentEstimate {
  durationS: number;
  costUsd: number;
  sampleRuns: number;
}

export function agentEstimateFor(stats: AgentCostEstimate | undefined | null): AgentEstimate | null {
  if (!stats || stats.avg_duration_ms == null || stats.avg_cost_usd == null || stats.sample_size <= 0) {
    return null;
  }
  return {
    durationS: stats.avg_duration_ms / 1000,
    costUsd: stats.avg_cost_usd,
    sampleRuns: stats.sample_size,
  };
}

/** Default selection once agents load: every currently-enabled agent
 *  (matches the precedent RunReviewDropdown's "Run all" sets — enabled
 *  agents are the sane default, everything else opt-in). */
export function defaultSelectedAgentIds(agents: { id: string; enabled: boolean }[]): string[] {
  return agents.filter((a) => a.enabled).map((a) => a.id);
}
