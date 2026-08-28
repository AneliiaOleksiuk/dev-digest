import { and, avg, count, desc, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { RunSummary, RunTrace } from '@devdigest/shared';
import { rollupSeverities } from '../../pulls/status.js';

export type MultiAgentRunRow = typeof t.multiAgentRuns.$inferSelect;
export type AgentRunRow = typeof t.agentRuns.$inferSelect;

// ---- in-flight / history --------------------------------------------------

/** In-flight runs for a PR (status='running') — the server-side source of
 *  truth for "which agents are running now". Joined with the agent name. */
export async function activeRunsForPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<{ run_id: string; agent_id: string | null; agent_name: string | null; ran_at: string | null }[]> {
  const rows = await db
    .select({
      id: t.agentRuns.id,
      agentId: t.agentRuns.agentId,
      ranAt: t.agentRuns.ranAt,
      agentName: t.agents.name,
    })
    .from(t.agentRuns)
    .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
    .where(
      and(
        eq(t.agentRuns.workspaceId, workspaceId),
        eq(t.agentRuns.prId, prId),
        eq(t.agentRuns.status, 'running'),
      ),
    );
  return rows.map((r) => ({
    run_id: r.id,
    agent_id: r.agentId,
    agent_name: r.agentName ?? null,
    ran_at: r.ranAt ? r.ranAt.toISOString() : null,
  }));
}

/** All runs for a PR (any status), newest first — the PR run history. */
export async function listRunsForPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<RunSummary[]> {
  const rows = await db
    .select({ run: t.agentRuns, agentName: t.agents.name })
    .from(t.agentRuns)
    .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
    .where(and(eq(t.agentRuns.workspaceId, workspaceId), eq(t.agentRuns.prId, prId)))
    .orderBy(desc(t.agentRuns.ranAt));

  // Per-run FINDINGS severity breakdown — one more IN-query joining findings
  // to the review each run produced, grouped by run id (mirrors the PR-list
  // rollup in modules/pulls/routes.ts). Not filtered by dismissedAt, so the
  // totals stay consistent with the frozen findings_count/score above.
  const runIds = rows.map(({ run }) => run.id);
  const severityByRunId = new Map<string, ReturnType<typeof rollupSeverities>>();
  if (runIds.length > 0) {
    const findingRows = await db
      .select({ runId: t.reviews.runId, severity: t.findings.severity })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
      .where(and(inArray(t.reviews.runId, runIds), eq(t.reviews.kind, 'review')));
    const rowsByRunId = new Map<string, { severity: string }[]>();
    for (const fr of findingRows) {
      if (!fr.runId) continue;
      const group = rowsByRunId.get(fr.runId);
      if (group) group.push(fr);
      else rowsByRunId.set(fr.runId, [fr]);
    }
    for (const runId of runIds) {
      severityByRunId.set(runId, rollupSeverities(rowsByRunId.get(runId) ?? []));
    }
  }

  return rows.map(({ run, agentName }) => {
    const severity = severityByRunId.get(run.id);
    return {
      run_id: run.id,
      agent_id: run.agentId,
      agent_name: agentName ?? null,
      provider: run.provider,
      model: run.model,
      status: run.status,
      error: run.error,
      duration_ms: run.durationMs,
      tokens_in: run.tokensIn,
      tokens_out: run.tokensOut,
      cost_usd: run.costUsd,
      findings_count: run.findingsCount,
      grounding: run.grounding,
      ran_at: run.ranAt ? run.ranAt.toISOString() : null,
      score: run.score,
      blockers: run.blockers,
      critical_count: severity ? severity.critical : null,
      warning_count: severity ? severity.warning : null,
      suggestion_count: severity ? severity.suggestion : null,
    };
  });
}

/**
 * Delete one agent run (+ its trace via FK cascade) AND the review it produced.
 * Workspace-scoped. `reviews.run_id` has no FK to `agent_runs`, so the review
 * (and its findings, which DO cascade from `reviews`) must be removed explicitly
 * here — otherwise deleting a run from the timeline leaves its findings orphaned
 * in the Review Runs list below.
 */
export async function deleteAgentRun(
  db: Db,
  workspaceId: string,
  runId: string,
): Promise<boolean> {
  await db
    .delete(t.reviews)
    .where(and(eq(t.reviews.runId, runId), eq(t.reviews.workspaceId, workspaceId)));
  const rows = await db
    .delete(t.agentRuns)
    .where(and(eq(t.agentRuns.id, runId), eq(t.agentRuns.workspaceId, workspaceId)))
    .returning({ id: t.agentRuns.id });
  return rows.length > 0;
}

/** Mark a still-running run as cancelled (no-op if it already finished). */
export async function cancelRunIfRunning(db: Db, runId: string): Promise<boolean> {
  const rows = await db
    .update(t.agentRuns)
    .set({ status: 'cancelled' })
    .where(and(eq(t.agentRuns.id, runId), eq(t.agentRuns.status, 'running')))
    .returning({ id: t.agentRuns.id });
  return rows.length > 0;
}

/** On boot: any run still 'running' is orphaned (its process died / restarted),
 *  so mark it failed. Prevents permanently stuck "running" runs in the UI. */
export async function reapStaleRunningRuns(db: Db): Promise<number> {
  const rows = await db
    .update(t.agentRuns)
    .set({ status: 'failed' })
    .where(eq(t.agentRuns.status, 'running'))
    .returning({ id: t.agentRuns.id });
  return rows.length;
}

// ---- observability: agent_runs + run_traces -------------------------------

/** Create an agent_runs row in `running` state; returns its id (= the runId).
 *  `multiAgentRunId` is set only for a child run of a multi-agent batch
 *  (L07) — omitted/undefined for a normal single-agent run. */
export async function createAgentRun(
  db: Db,
  values: {
    workspaceId: string;
    agentId: string | null;
    prId: string;
    provider: string | null;
    model: string | null;
    multiAgentRunId?: string | null;
  },
): Promise<string> {
  const [row] = await db
    .insert(t.agentRuns)
    .values({
      workspaceId: values.workspaceId,
      agentId: values.agentId,
      prId: values.prId,
      provider: values.provider,
      model: values.model,
      multiAgentRunId: values.multiAgentRunId ?? null,
      status: 'running',
      source: 'local',
    })
    .returning({ id: t.agentRuns.id });
  return row!.id;
}

// ---- multi-agent batches (L07, SPEC-04) ------------------------------------

/** Create the ONE `multi_agent_runs` parent row for a batch. Children are
 *  separate `agent_runs` rows carrying `multiAgentRunId` (created via
 *  `createAgentRun` above). */
export async function createMultiAgentRun(
  db: Db,
  values: { workspaceId: string; prId: string },
): Promise<string> {
  const [row] = await db
    .insert(t.multiAgentRuns)
    .values({ workspaceId: values.workspaceId, prId: values.prId })
    .returning({ id: t.multiAgentRuns.id });
  return row!.id;
}

/** Workspace-scoped parent lookup — a foreign-workspace id (or unknown id)
 *  returns undefined so the route can 404 without leaking existence. */
export async function getMultiAgentRun(
  db: Db,
  workspaceId: string,
  id: string,
): Promise<MultiAgentRunRow | undefined> {
  const [row] = await db
    .select()
    .from(t.multiAgentRuns)
    .where(and(eq(t.multiAgentRuns.workspaceId, workspaceId), eq(t.multiAgentRuns.id, id)));
  return row;
}

/** Every child `agent_runs` row of a batch, joined with the agent's CURRENT
 *  name (the run's own `provider`/`model` are used for display, NOT a fresh
 *  join to `agents` — they're captured at run-creation time and must reflect
 *  what actually ran, even if the agent's config changed since). */
export async function listChildRuns(
  db: Db,
  workspaceId: string,
  multiAgentRunId: string,
): Promise<{ run: AgentRunRow; agentName: string | null }[]> {
  return db
    .select({ run: t.agentRuns, agentName: t.agents.name })
    .from(t.agentRuns)
    .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
    .where(
      and(eq(t.agentRuns.workspaceId, workspaceId), eq(t.agentRuns.multiAgentRunId, multiAgentRunId)),
    );
}

/**
 * Per-agent avg duration + avg cost for EVERY agent in `agentIds`, in ONE
 * query (fix-loop iteration 1 — was an N+1: one `avg()` round trip per agent
 * behind `GET /agents/stats`). Grouped by `(agent_id, model)` rather than
 * filtered to a single model up front, since different agents in the same
 * batch can have different CURRENT models (OQ-6) — the caller matches each
 * agent's own current `model` against this result to exclude runs against a
 * since-changed model, the same semantics the old per-agent query enforced
 * via its `eq(model, ...)` WHERE clause. Only `status='done'` runs count
 * (failed/cancelled runs have no meaningful cost/duration signal).
 */
export async function avgStatsForAgents(
  db: Db,
  workspaceId: string,
  agentIds: string[],
): Promise<
  { agentId: string; model: string | null; avgDurationMs: number | null; avgCostUsd: number | null; sampleSize: number }[]
> {
  if (agentIds.length === 0) return [];
  const rows = await db
    .select({
      agentId: t.agentRuns.agentId,
      model: t.agentRuns.model,
      avgDurationMs: avg(t.agentRuns.durationMs),
      avgCostUsd: avg(t.agentRuns.costUsd),
      sampleSize: count(),
    })
    .from(t.agentRuns)
    .where(
      and(
        eq(t.agentRuns.workspaceId, workspaceId),
        inArray(t.agentRuns.agentId, agentIds),
        eq(t.agentRuns.status, 'done'),
      ),
    )
    .groupBy(t.agentRuns.agentId, t.agentRuns.model);
  return rows.map((r) => ({
    agentId: r.agentId!,
    model: r.model,
    avgDurationMs: r.sampleSize > 0 && r.avgDurationMs != null ? Number(r.avgDurationMs) : null,
    avgCostUsd: r.sampleSize > 0 && r.avgCostUsd != null ? Number(r.avgCostUsd) : null,
    sampleSize: r.sampleSize,
  }));
}

// ---- SPEC-06: the shared counted-run-set aggregation ----------------------

/**
 * Per-`(agent_id, model)` run/cost/duration aggregate — computed ENTIRELY in
 * SQL via `GROUP BY` (fix-loop A3: previously the raw, unaggregated counted
 * run set was materialized into Node and summed there; every run-level
 * number — not just the trend — is now a SQL aggregate, and the raw row set
 * is never read into Node at all). `costSum`/`durationSum` are sums of
 * NON-NULL values only; `hasNullCost` flags when at least one counted run in
 * this `(agent, model)` group has a NULL `cost_usd` (E-9), so the caller
 * never coerces NULL to 0.
 */
export interface PerfRunAggRow {
  agentId: string;
  model: string | null;
  runs: number;
  costSum: number | null;
  costCount: number;
  hasNullCost: boolean;
  durationSum: number | null;
  durationCount: number;
  lastRunAt: Date;
}

/**
 * Per-`(agent_id, bucket)` trend point — `bucket` is 0-indexed into
 * `bucketCount` equal-width slices of `range`, computed in SQL via
 * `width_bucket()` (fix-loop A3) so bucketing the trend never requires
 * reading a raw per-run row into Node either.
 */
export interface PerfTrendRow {
  agentId: string;
  bucket: number;
  findingsSum: number;
  runCount: number;
}

/** Findings rolled up in SQL by `(agent_id, severity)` — never loaded into
 *  Node as raw finding rows (NFR-3). */
export interface PerfFindingAggRow {
  agentId: string;
  severity: string;
  total: number;
  accepted: number;
  dismissed: number;
}

export interface PerfRangeResult {
  runAgg: PerfRunAggRow[];
  trend: PerfTrendRow[];
  findings: PerfFindingAggRow[];
}

/**
 * WI2 (SPEC-06) — the ONE counted-run-set aggregation shared by
 * `GET /agents/:id/stats` (called with one agent id) and
 * `GET /agents/performance` (called with the workspace's agent ids) —
 * AC-7/AC-8/AC-18: a per-agent number is identical on both surfaces because
 * both call THIS function, never a second formula.
 *
 * THREE queries total, independent of `agentIds.length` AND of how many rows
 * are in the counted set (NFR-3/NFR-4 — no per-agent round trips, and no
 * per-run Node materialization either, fix-loop A3):
 *   1. `agent_runs` GROUP BY `(agent_id, model)` — run counts, cost sums
 *      (with null-cost tracking, D-14/E-9), per-model cost split, avg
 *      duration, `last_run_at`. `countedFilter` below is `workspace_id` =
 *      caller's workspace, `ran_at` within the half-open
 *      `[range.start, range.end)` (AC-2/AC-3), `status = 'done'`,
 *      `agent_id IS NOT NULL` (AC-8/AC-9, D-12/D-17). No `source` filter —
 *      CI runs count alongside local runs (D-16), matching `avgStatsForAgents`
 *      above.
 *   2. `agent_runs` GROUP BY `(agent_id, width_bucket(ran_at))` — the
 *      findings-per-run trend (bucketed further in
 *      `modules/agents/performance.ts`, pure), same `countedFilter`.
 *      `width_bucket` slices `[range.start, range.end)` into `bucketCount`
 *      equal-width buckets entirely in SQL.
 *   3. `findings` ⋈ `reviews` GROUP BY `(reviews.agent_id, findings.severity)`
 *      with conditional accepted/dismissed counts, scoped to the SAME
 *      counted run set via an INNER JOIN on `agent_runs` using
 *      `countedFilter` directly (fix-loop A3: replaces an unbounded
 *      `inArray(reviews.runId, runIds)` — one bind parameter per counted run,
 *      with no cap, which could exceed Postgres's 65535-parameter protocol
 *      limit on a busy workspace's max-span range). `reviews.runId` has no
 *      FK (E-15), so a stale run_id simply drops out; `reviews.kind = 'review'`
 *      (E-16) stops `kind:'summary'` rows inflating counts.
 * Severity is read ONLY via this findings join — never
 * `agent_runs.critical/.warning/.suggestion` (CI-ingest-only columns,
 * AC-11/D-6, NULL for every local run).
 */
export async function perfStatsForAgents(
  db: Db,
  workspaceId: string,
  agentIds: string[],
  range: { start: Date; end: Date },
  bucketCount: number,
): Promise<PerfRangeResult> {
  if (agentIds.length === 0) return { runAgg: [], trend: [], findings: [] };

  const countedFilter = and(
    eq(t.agentRuns.workspaceId, workspaceId),
    inArray(t.agentRuns.agentId, agentIds),
    eq(t.agentRuns.status, 'done'),
    isNotNull(t.agentRuns.agentId),
    gte(t.agentRuns.ranAt, range.start),
    lt(t.agentRuns.ranAt, range.end),
  );

  // 1) Per-(agent, model) run/cost/duration aggregate — SQL GROUP BY.
  const runAggRows = await db
    .select({
      agentId: t.agentRuns.agentId,
      model: t.agentRuns.model,
      runs: count(),
      costSum: sql<string | null>`sum(${t.agentRuns.costUsd}) filter (where ${t.agentRuns.costUsd} is not null)`,
      costCount: sql<number>`count(*) filter (where ${t.agentRuns.costUsd} is not null)::int`,
      hasNullCost: sql<boolean>`bool_or(${t.agentRuns.costUsd} is null)`,
      durationSum: sql<string | null>`sum(${t.agentRuns.durationMs}) filter (where ${t.agentRuns.durationMs} is not null)`,
      durationCount: sql<number>`count(*) filter (where ${t.agentRuns.durationMs} is not null)::int`,
      lastRunAt: sql<Date>`max(${t.agentRuns.ranAt})`,
    })
    .from(t.agentRuns)
    .where(countedFilter)
    .groupBy(t.agentRuns.agentId, t.agentRuns.model);

  const runAgg: PerfRunAggRow[] = runAggRows.map((r) => ({
    agentId: r.agentId!,
    model: r.model,
    runs: r.runs,
    costSum: r.costSum == null ? null : Number(r.costSum),
    costCount: r.costCount,
    hasNullCost: r.hasNullCost,
    durationSum: r.durationSum == null ? null : Number(r.durationSum),
    durationCount: r.durationCount,
    // A raw `sql<Date>` fragment (no declared column type for drizzle to
    // decode) comes back from the driver as a plain timestamptz STRING, not
    // a Date — unlike `t.agentRuns.ranAt` selected directly, which drizzle's
    // own column decoder converts. Parse explicitly; `.toISOString()`
    // downstream (performance.ts) would otherwise throw at runtime (fix-loop:
    // caught via a live repro, not by typecheck — the `sql<Date>` annotation
    // only affects the TS type, never the runtime value).
    lastRunAt: new Date(r.lastRunAt as unknown as string),
  }));

  if (runAgg.length === 0) return { runAgg, trend: [], findings: [] };

  // 2) Per-(agent, bucket) trend — width_bucket() slices `range` into
  //    `bucketCount` equal-width buckets in SQL; clamped defensively even
  //    though `countedFilter` already restricts ran_at to [start, end).
  //    Computed as a derived subquery first (`bucketedRuns`), THEN grouped —
  //    Postgres requires GROUP BY to reference a real column, not a repeated
  //    raw expression fragment; re-emitting the same `width_bucket(...)` SQL
  //    text in both the SELECT list and GROUP BY (without a subquery) 42803s
  //    with "column agent_runs.ran_at must appear in the GROUP BY clause".
  const startEpoch = range.start.getTime() / 1000;
  const endEpoch = range.end.getTime() / 1000;
  const bucketedRuns = db
    .select({
      agentId: t.agentRuns.agentId,
      bucket: sql<number>`least(${bucketCount - 1}, greatest(0, width_bucket(extract(epoch from ${t.agentRuns.ranAt}), ${startEpoch}, ${endEpoch}, ${bucketCount}) - 1))`.as(
        'bucket',
      ),
      findingsCount: t.agentRuns.findingsCount,
    })
    .from(t.agentRuns)
    .where(countedFilter)
    .as('bucketed_runs');

  const trendRows = await db
    .select({
      agentId: bucketedRuns.agentId,
      bucket: bucketedRuns.bucket,
      findingsSum: sql<number>`coalesce(sum(${bucketedRuns.findingsCount}), 0)::int`,
      runCount: count(),
    })
    .from(bucketedRuns)
    .groupBy(bucketedRuns.agentId, bucketedRuns.bucket);

  const trend: PerfTrendRow[] = trendRows.map((r) => ({
    agentId: r.agentId!,
    bucket: r.bucket,
    findingsSum: r.findingsSum,
    runCount: r.runCount,
  }));

  // 3) findings ⋈ reviews GROUP BY (agent_id, severity), scoped to the SAME
  //    counted run set via an INNER JOIN on agent_runs — never an unbounded
  //    inArray(reviews.runId, runIds) bind list.
  const findingRows = await db
    .select({
      agentId: t.reviews.agentId,
      severity: t.findings.severity,
      total: count(),
      accepted: sql<number>`count(*) filter (where ${t.findings.acceptedAt} is not null)::int`,
      dismissed: sql<number>`count(*) filter (where ${t.findings.dismissedAt} is not null)::int`,
    })
    .from(t.findings)
    .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
    .innerJoin(t.agentRuns, eq(t.agentRuns.id, t.reviews.runId))
    .where(
      and(
        countedFilter,
        eq(t.reviews.kind, 'review'),
        isNotNull(t.reviews.agentId),
        inArray(t.reviews.agentId, agentIds),
      ),
    )
    .groupBy(t.reviews.agentId, t.findings.severity);

  const findings: PerfFindingAggRow[] = findingRows.map((r) => ({
    agentId: r.agentId!,
    severity: r.severity,
    total: r.total,
    accepted: Number(r.accepted),
    dismissed: Number(r.dismissed),
  }));

  return { runAgg, trend, findings };
}

export async function completeAgentRun(
  db: Db,
  runId: string,
  values: {
    status: 'done' | 'failed' | 'cancelled';
    durationMs: number;
    tokensIn: number;
    tokensOut: number;
    costUsd: number | null;
    findingsCount: number;
    grounding: string;
    /** Review score (0-100); null on failed/cancelled runs. */
    score?: number | null;
    /** Findings that tripped the agent's gate; 0 on failed/cancelled runs. */
    blockers?: number | null;
    /** Failure reason (status='failed') / cancellation note. Null clears it. */
    error?: string | null;
  },
): Promise<void> {
  await db
    .update(t.agentRuns)
    .set({
      status: values.status,
      durationMs: values.durationMs,
      tokensIn: values.tokensIn,
      tokensOut: values.tokensOut,
      costUsd: values.costUsd,
      findingsCount: values.findingsCount,
      grounding: values.grounding,
      score: values.score ?? null,
      blockers: values.blockers ?? null,
      error: values.error ?? null,
    })
    .where(eq(t.agentRuns.id, runId));
}

/** Persist the WHOLE run log as ONE document. PK = runId → agent_runs. */
export async function saveRunTrace(db: Db, runId: string, trace: RunTrace): Promise<void> {
  await db
    .insert(t.runTraces)
    .values({ runId, trace })
    .onConflictDoUpdate({ target: t.runTraces.runId, set: { trace } });
}

export async function getRunTrace(db: Db, runId: string): Promise<RunTrace | undefined> {
  const [row] = await db.select().from(t.runTraces).where(eq(t.runTraces.runId, runId));
  return row ? (row.trace as RunTrace) : undefined;
}
