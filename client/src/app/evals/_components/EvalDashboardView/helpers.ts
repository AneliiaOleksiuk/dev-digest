import type { Agent } from "@devdigest/shared";
import type { EvalDashboard } from "@/lib/types";

/** Every non-null value in `EvalDashboard.trend`'s recall series, oldest
 *  first — what `Sparkline` needs (it draws whatever numbers it's given,
 *  with no null-handling of its own). */
export function trendSparkline(dashboard: EvalDashboard, metric: "recall" | "precision" | "citation_accuracy") {
  return dashboard.trend.map((p) => p[metric]).filter((v): v is number => v != null);
}

/** Display name for a dashboard row's owner — falls back to a truncated
 *  id when the owning agent no longer resolves (E-15: an agent can be
 *  deleted while it still owns cases/batches). */
export function ownerLabel(dashboard: EvalDashboard, agentsById: Map<string, Agent>): string {
  if (!dashboard.owner_id) return "—";
  const agent = agentsById.get(dashboard.owner_id);
  if (agent) return agent.name;
  return `${dashboard.owner_id.slice(0, 8)}… (deleted agent)`;
}
