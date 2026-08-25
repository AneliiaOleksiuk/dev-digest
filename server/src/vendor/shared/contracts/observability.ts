import { z } from 'zod';
import { Severity, FindingCategory } from './findings.js';

/**
 * A5 — Observability / Multi-agent contracts (L07).
 *
 * These are NEW contracts (A5 owns this file; the barrel re-exports it). They
 * sit alongside A2's `review-api.ts`:
 *   - MultiAgentRun        the response of POST /pulls/:id/multi-agent-run
 *   - AgentColumn          one agent's column in the multi-agent view
 *   - FindingGroup         near-duplicate findings across runs of one batch,
 *                          derived at read time (AC-22..AC-25), never persisted
 *   - Conflict / ConflictTake  where agents disagree on the same file:line
 *   - AgentStats           per-agent quality aggregates (GET /agents/:id/stats)
 *   - CuratorResult        the cross-session memory curator outcome
 *
 * The single-document run trace itself stays in `contracts/trace.ts` (RunTrace).
 */

// ---------------------------------------------------------------------------
// Multi-Agent Review
// ---------------------------------------------------------------------------

/** A finding as surfaced in a multi-agent column (subset of FindingRecord). */
export const AgentColumnFinding = z.object({
  id: z.string(),
  severity: Severity,
  category: z.string(),
  title: z.string(),
  file: z.string(),
  start_line: z.number().int(),
  kind: z.string().nullish(),
});
export type AgentColumnFinding = z.infer<typeof AgentColumnFinding>;

/** One agent's result column in the multi-agent review. */
export const AgentColumn = z.object({
  run_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  status: z.enum(['done', 'failed', 'running', 'cancelled']),
  verdict: z.string().nullable(),
  score: z.number().int().nullable(),
  summary: z.string().nullable(),
  /** Failure/cancellation reason (`agent_runs.error`), populated only when
   *  `status` is `'failed'` or `'cancelled'` — never a substitute for
   *  `summary`, which only ever carries a genuine review summary. Nullish
   *  (not just nullable), matching this file's convention for a field that
   *  legitimately isn't present on every row (cf. `AgentColumnFinding.kind`,
   *  `FindingGroupMember.suggestion`) — keeps every pre-existing hand-built
   *  `AgentColumn` object literal (fixtures/tests) valid without the field. */
  error: z.string().nullish(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  findings: z.array(AgentColumnFinding),
});
export type AgentColumn = z.infer<typeof AgentColumn>;

/**
 * One agent's own finding inside a `FindingGroup`. Fields are copied
 * VERBATIM from the underlying `Finding` row (AC-24 forbids paraphrase or
 * merge) — this is a read projection, not a rewrite.
 */
export const FindingGroupMember = z.object({
  id: z.string(),
  run_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
  severity: Severity,
  title: z.string(),
  rationale: z.string(),
  suggestion: z.string().nullish(),
  confidence: z.number().min(0).max(1),
});
export type FindingGroupMember = z.infer<typeof FindingGroupMember>;

/**
 * Near-duplicate findings from different runs of the same batch, grouped by
 * (normalized) file + category + overlapping line range (AC-22). Derived from
 * persisted findings at read time; never stored, never mutates/merges the
 * underlying `findings` rows (AC-23). A finding flagged by only one agent
 * still appears, as a group of one (AC-25).
 */
export const FindingGroup = z.object({
  file: z.string(),
  /** `file` after path normalization (E-12), used only for the grouping match. */
  normalized_file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  category: FindingCategory,
  members: z.array(FindingGroupMember),
});
export type FindingGroup = z.infer<typeof FindingGroup>;

/** One agent's stance on a contended file:line. */
export const ConflictTake = z.object({
  agent_id: z.string(),
  persona: z.string(),
  /** Severity if the agent flagged it, or 'ignored' when it did not. */
  verdict: z.union([Severity, z.literal('ignored')]),
  note: z.string(),
});
export type ConflictTake = z.infer<typeof ConflictTake>;

/**
 * A conflict = a file:line that at least one agent flagged and at least one
 * other agent (that also reviewed) did NOT, OR where agents assigned divergent
 * severities. Computed from persisted findings; not stored.
 */
export const Conflict = z.object({
  file: z.string(),
  line: z.number().int(),
  title: z.string(),
  takes: z.array(ConflictTake),
});
export type Conflict = z.infer<typeof Conflict>;

/** Response of POST /pulls/:id/multi-agent-run and GET /pulls/:id/multi-agent. */
export const MultiAgentRun = z.object({
  id: z.string(),
  pr_id: z.string(),
  pr_number: z.number().int().nullish(),
  ran_at: z.string(),
  agent_count: z.number().int(),
  total_duration_ms: z.number().int(),
  total_cost_usd: z.number().nullable(),
  /**
   * True when at least one participating run has a null `cost_usd`, so
   * `total_cost_usd` is an under-count rather than a complete sum (AC-15,
   * OQ-1 — badge as partial rather than suppress).
   */
  total_cost_partial: z.boolean().default(false),
  columns: z.array(AgentColumn),
  /** Near-duplicate findings across runs, grouped for display (AC-22..AC-25). */
  groups: z.array(FindingGroup),
  conflicts: z.array(Conflict),
});
export type MultiAgentRun = z.infer<typeof MultiAgentRun>;

// ---------------------------------------------------------------------------
// Per-agent Stats (GET /agents/:id/stats)
// ---------------------------------------------------------------------------

/** A single (date, value) point for a sparkline/trend. */
export const StatPoint = z.object({ label: z.string(), value: z.number() });
export type StatPoint = z.infer<typeof StatPoint>;

export const AgentStats = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  runs: z.number().int(),
  findings_total: z.number().int(),
  /** accept-rate is the headline quality signal. 0..1 over acted findings. */
  accepted: z.number().int(),
  dismissed: z.number().int(),
  pending: z.number().int(),
  accept_rate: z.number().nullable(),
  dismiss_rate: z.number().nullable(),
  avg_findings_per_run: z.number().nullable(),
  total_cost_usd: z.number().nullable(),
  avg_cost_usd: z.number().nullable(),
  avg_latency_ms: z.number().nullable(),
  findings_by_severity: z.object({
    CRITICAL: z.number().int(),
    WARNING: z.number().int(),
    SUGGESTION: z.number().int(),
  }),
  /** recent runs for a small trend chart (oldest→newest). */
  trend: z.array(StatPoint),
});
export type AgentStats = z.infer<typeof AgentStats>;

// ---------------------------------------------------------------------------
// Cross-session memory curator
// ---------------------------------------------------------------------------

/** A merge the curator performed (or would perform in dry-run). */
export const CuratorMerge = z.object({
  kept_id: z.string(),
  merged_ids: z.array(z.string()),
  content: z.string(),
  similarity: z.number(),
});
export type CuratorMerge = z.infer<typeof CuratorMerge>;

export const CuratorResult = z.object({
  scanned: z.number().int(),
  merges: z.array(CuratorMerge),
  removed: z.number().int(),
  dry_run: z.boolean(),
});
export type CuratorResult = z.infer<typeof CuratorResult>;
