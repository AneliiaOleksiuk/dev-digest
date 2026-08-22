import type { EvalDashboard } from "@/lib/types";

/**
 * `LineChart` (`@devdigest/ui`, do-not-touch) fills a missing index with
 * `0` (`row[s.name] = s.data[i] ?? 0`) — passing a `null` metric straight
 * through would silently render as a real (and misleadingly LOW) point,
 * exactly what E-11/AC-24/25/27 forbid. Filtering each series' nulls out
 * independently avoids fabricating a 0, at the honestly-documented cost of
 * the two series' points no longer sharing the same x index when they have
 * different null patterns (`AgentEvalDetail`'s chart caption says so). No
 * new chart component is added (AC-38) — this is the best fit inside that
 * constraint, not a claim that x-axis alignment is preserved.
 */
export function trendSeries(dashboard: EvalDashboard, metric: "recall" | "precision" | "citation_accuracy") {
  return dashboard.trend.map((p) => p[metric]).filter((v): v is number => v != null);
}
