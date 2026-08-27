import type { AgentPerf, AgentPerfRow, AgentStats, PerfCostSegment, StatPoint } from '@devdigest/shared';
import type { PerfFindingAggRow, PerfRangeResult, PerfRunRow } from '../reviews/repository/run.repo.js';

/**
 * WI3 (SPEC-06) — pure shaping, no I/O (same contract as `helpers.ts`'s
 * docblock). Two projections over the SAME `PerfRangeResult` (WI2):
 *   - `toAgentStats`  → `AgentStats`  (GET /agents/:id/stats, AC-15 unchanged)
 *   - `toAgentPerf`   → `AgentPerf`   (GET /agents/performance)
 * There is no second accept-rate or cost formula anywhere in this file —
 * both projections read from the same per-agent aggregate helpers below
 * (AC-7/AC-18).
 */

const BUCKET_COUNT = 12;
const UNKNOWN_MODEL = 'unknown';

export interface AgentMeta {
  id: string;
  name: string;
  provider: string;
  model: string;
}

interface PerAgentRunAgg {
  runs: number;
  /** Sum of NON-NULL cost_usd only — never coerces a null to 0 (E-9). */
  costSum: number;
  costCount: number;
  /** True when at least one counted run for this agent has a NULL cost_usd. */
  hasNullCost: boolean;
  durationSum: number;
  durationCount: number;
  lastRunAt: Date | null;
  costByModel: Map<string, number>;
  bucketFindingsSum: number[];
  bucketRunCount: number[];
}

function emptyRunAgg(): PerAgentRunAgg {
  return {
    runs: 0,
    costSum: 0,
    costCount: 0,
    hasNullCost: false,
    durationSum: 0,
    durationCount: 0,
    lastRunAt: null,
    costByModel: new Map(),
    bucketFindingsSum: new Array(BUCKET_COUNT).fill(0),
    bucketRunCount: new Array(BUCKET_COUNT).fill(0),
  };
}

/** Which of `BUCKET_COUNT` equal-width slices of `range` a run's `ranAt`
 *  falls into — clamped so a boundary-exact timestamp never overflows. */
function bucketIndex(ranAt: Date, range: { start: Date; end: Date }): number {
  const span = range.end.getTime() - range.start.getTime();
  if (span <= 0) return 0;
  const pos = (ranAt.getTime() - range.start.getTime()) / span;
  return Math.min(BUCKET_COUNT - 1, Math.max(0, Math.floor(pos * BUCKET_COUNT)));
}

/** Group the WI2 raw run rows by agent — the shared aggregate both
 *  projections read cost/duration/trend numbers from. */
function aggregateRuns(
  runs: PerfRunRow[],
  range: { start: Date; end: Date },
): Map<string, PerAgentRunAgg> {
  const byAgent = new Map<string, PerAgentRunAgg>();
  for (const run of runs) {
    let agg = byAgent.get(run.agentId);
    if (!agg) {
      agg = emptyRunAgg();
      byAgent.set(run.agentId, agg);
    }
    agg.runs += 1;
    if (run.costUsd == null) {
      agg.hasNullCost = true;
    } else {
      agg.costSum += run.costUsd;
      agg.costCount += 1;
      const modelKey = run.model ?? UNKNOWN_MODEL;
      agg.costByModel.set(modelKey, (agg.costByModel.get(modelKey) ?? 0) + run.costUsd);
    }
    if (run.durationMs != null) {
      agg.durationSum += run.durationMs;
      agg.durationCount += 1;
    }
    if (!agg.lastRunAt || run.ranAt > agg.lastRunAt) agg.lastRunAt = run.ranAt;
    const idx = bucketIndex(run.ranAt, range);
    agg.bucketFindingsSum[idx] = (agg.bucketFindingsSum[idx] ?? 0) + (run.findingsCount ?? 0);
    agg.bucketRunCount[idx] = (agg.bucketRunCount[idx] ?? 0) + 1;
  }
  return byAgent;
}

interface FindingTotals {
  total: number;
  accepted: number;
  dismissed: number;
  bySeverity: { CRITICAL: number; WARNING: number; SUGGESTION: number };
}

function emptyFindingTotals(): FindingTotals {
  return { total: 0, accepted: 0, dismissed: 0, bySeverity: { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 } };
}

/** Group the WI2 SQL-aggregated findings rows by agent. */
function aggregateFindings(rows: PerfFindingAggRow[]): Map<string, FindingTotals> {
  const byAgent = new Map<string, FindingTotals>();
  for (const row of rows) {
    let totals = byAgent.get(row.agentId);
    if (!totals) {
      totals = emptyFindingTotals();
      byAgent.set(row.agentId, totals);
    }
    totals.total += row.total;
    totals.accepted += row.accepted;
    totals.dismissed += row.dismissed;
    if (row.severity === 'CRITICAL' || row.severity === 'WARNING' || row.severity === 'SUGGESTION') {
      totals.bySeverity[row.severity] += row.total;
    }
  }
  return byAgent;
}

/** accepted / (accepted + dismissed) — null (never 0) when nothing is
 *  decided yet (AC-12, E-10). */
function acceptRate(accepted: number, dismissed: number): number | null {
  const decided = accepted + dismissed;
  return decided > 0 ? accepted / decided : null;
}

function trendArray(agg: PerAgentRunAgg | undefined): number[] {
  if (!agg) return new Array(BUCKET_COUNT).fill(0);
  return agg.bucketFindingsSum.map((sum, i) => {
    const runCount = agg.bucketRunCount[i] ?? 0;
    return runCount > 0 ? sum / runCount : 0;
  });
}

function bucketLabel(i: number, range: { start: Date; end: Date }): string {
  const span = range.end.getTime() - range.start.getTime();
  const t = range.start.getTime() + (span * i) / BUCKET_COUNT;
  return new Date(t).toISOString().slice(0, 10);
}

/** One agent's `AgentStats` (GET /agents/:id/stats) — AC-15's contract,
 *  adopted UNCHANGED. `data` must already be scoped to just this agent
 *  (the caller passes `[agent.id]` into `perfStatsForAgents`). */
export function toAgentStats(agent: AgentMeta, data: PerfRangeResult, range: { start: Date; end: Date }): AgentStats {
  const runAgg = aggregateRuns(data.runs, range).get(agent.id);
  const findingAgg = aggregateFindings(data.findings).get(agent.id) ?? emptyFindingTotals();

  const runs = runAgg?.runs ?? 0;
  const { accepted, dismissed } = findingAgg;
  const pending = Math.max(0, findingAgg.total - accepted - dismissed);
  const rate = acceptRate(accepted, dismissed);

  const trend: StatPoint[] = trendArray(runAgg).map((value, i) => ({ label: bucketLabel(i, range), value }));

  return {
    agent_id: agent.id,
    agent_name: agent.name,
    runs,
    findings_total: findingAgg.total,
    accepted,
    dismissed,
    pending,
    accept_rate: rate,
    dismiss_rate: rate == null ? null : 1 - rate,
    avg_findings_per_run: runs > 0 ? findingAgg.total / runs : null,
    total_cost_usd: runAgg && runAgg.costCount > 0 ? runAgg.costSum : null,
    avg_cost_usd: runAgg && runAgg.costCount > 0 ? runAgg.costSum / runAgg.costCount : null,
    avg_latency_ms: runAgg && runAgg.durationCount > 0 ? runAgg.durationSum / runAgg.durationCount : null,
    findings_by_severity: findingAgg.bySeverity,
    trend,
  };
}

/** Every workspace agent's `AgentPerf` (GET /agents/performance). `agents`
 *  must include every agent to score, even ones with zero runs in range
 *  (AC-28/AC-37 — they still get a zero row, `accept_rate: null`). */
export function toAgentPerf(
  agents: AgentMeta[],
  data: PerfRangeResult,
  range: { start: Date; end: Date },
): AgentPerf {
  const runsByAgent = aggregateRuns(data.runs, range);
  const findingsByAgent = aggregateFindings(data.findings);

  const costByAgentMap = new Map<string, number>();
  const costByModelMap = new Map<string, number>();
  let totalRuns = 0;
  let totalCostSum = 0;
  let totalCostCount = 0;
  let anyNullCost = false;
  let totalAccepted = 0;
  let totalDecided = 0;
  let mostActiveId: string | null = null;
  let mostActiveName: string | null = null;
  let mostActiveRuns = 0;
  let mostActiveLastRunAt: Date | null = null;

  const rows: AgentPerfRow[] = [];
  for (const agent of agents) {
    const runAgg = runsByAgent.get(agent.id);
    const findingAgg = findingsByAgent.get(agent.id) ?? emptyFindingTotals();
    const runs = runAgg?.runs ?? 0;
    const { accepted, dismissed } = findingAgg;
    const rate = acceptRate(accepted, dismissed);

    totalRuns += runs;
    totalAccepted += accepted;
    totalDecided += accepted + dismissed;
    if (runAgg) {
      totalCostSum += runAgg.costSum;
      totalCostCount += runAgg.costCount;
      if (runAgg.hasNullCost) anyNullCost = true;
      if (runAgg.costCount > 0) {
        costByAgentMap.set(agent.name, (costByAgentMap.get(agent.name) ?? 0) + runAgg.costSum);
      }
      for (const [model, sum] of runAgg.costByModel) {
        costByModelMap.set(model, (costByModelMap.get(model) ?? 0) + sum);
      }
    }
    // D-5/E-5: most-active resolved by run count (tie-break: most recent
    // last_run_at), tracked by id — `agents.name` has no unique constraint.
    if (runs > 0) {
      const lastRunAt = runAgg?.lastRunAt ?? null;
      const better =
        mostActiveId == null ||
        runs > mostActiveRuns ||
        (runs === mostActiveRuns &&
          !!lastRunAt &&
          (!mostActiveLastRunAt || lastRunAt > mostActiveLastRunAt));
      if (better) {
        mostActiveId = agent.id;
        mostActiveName = agent.name;
        mostActiveRuns = runs;
        mostActiveLastRunAt = lastRunAt;
      }
    }

    rows.push({
      agent_id: agent.id,
      agent_name: agent.name,
      provider: agent.provider,
      model: agent.model,
      runs,
      findings_total: findingAgg.total,
      accepted,
      dismissed,
      accept_rate: rate,
      dismiss_rate: rate == null ? null : 1 - rate,
      avg_findings_per_run: runs > 0 ? findingAgg.total / runs : null,
      total_cost_usd: runAgg && runAgg.costCount > 0 ? runAgg.costSum : null,
      avg_cost_usd: runAgg && runAgg.costCount > 0 ? runAgg.costSum / runAgg.costCount : null,
      avg_latency_ms: runAgg && runAgg.durationCount > 0 ? runAgg.durationSum / runAgg.durationCount : null,
      last_run_at: runAgg?.lastRunAt ? runAgg.lastRunAt.toISOString() : null,
      findings_by_severity: findingAgg.bySeverity,
      trend: trendArray(runAgg),
    });
  }

  const costByAgent: PerfCostSegment[] = [...costByAgentMap.entries()].map(([label, value]) => ({
    label,
    value,
  }));
  const costByModel: PerfCostSegment[] = [...costByModelMap.entries()].map(([label, value]) => ({
    label,
    value,
  }));

  return {
    summary: {
      runs: totalRuns,
      // D-12: total *attributable* spend — sum of non-null cost_usd across
      // the counted set only; null (never 0) when nothing has cost data yet.
      total_cost_usd: totalCostCount > 0 ? totalCostSum : null,
      // D-13: the POOLED rate (total accepted / total decided), not the
      // unweighted mean of per-agent rates, despite the `avg_` field name.
      avg_accept_rate: totalDecided > 0 ? totalAccepted / totalDecided : null,
      most_active_agent: mostActiveName,
      most_active_agent_id: mostActiveId,
      // D-14/AC-27 — true when ANY counted run has a NULL cost_usd, so
      // total_cost_usd is flagged as an under-count rather than presented
      // as complete.
      total_cost_partial: anyNullCost,
    },
    agents: rows,
    cost_by_agent: costByAgent,
    cost_by_model: costByModel,
  };
}
