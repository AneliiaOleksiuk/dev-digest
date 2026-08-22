import { MultiAgentRun } from '@devdigest/shared';
import type { AgentColumn, AgentColumnFinding, Severity } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import type { ReviewRepository } from './repository.js';
import { deriveConflicts, deriveFindingGroups, type DerivableRun } from './multi-agent-derive.js';

/**
 * L07 (SPEC-04) — batch read/assembly. Composes WI4's repository reads +
 * WI6's pure derivation into the `MultiAgentRun` response. Everything here
 * is derived at READ time and mutates nothing (groups/conflicts are never
 * persisted). Always addressed by a specific batch id — never "latest for
 * this PR" (WI7).
 */
export class MultiAgentReadService {
  constructor(private repo: ReviewRepository) {}

  async getBatch(workspaceId: string, multiAgentRunId: string): Promise<MultiAgentRun> {
    const parent = await this.repo.getMultiAgentRun(workspaceId, multiAgentRunId);
    if (!parent) throw new NotFoundError('Multi-agent run not found');

    const children = await this.repo.listChildRuns(workspaceId, multiAgentRunId);
    const pull = await this.repo.getPull(workspaceId, parent.prId);

    if (children.length === 0) {
      return MultiAgentRun.parse({
        id: parent.id,
        pr_id: parent.prId,
        pr_number: pull?.number ?? null,
        ran_at: parent.ranAt.toISOString(),
        agent_count: 0,
        total_duration_ms: 0,
        total_cost_usd: null,
        total_cost_partial: false,
        columns: [],
        groups: [],
        conflicts: [],
      });
    }

    const runIds = children.map((c) => c.run.id);
    const findingsByRunId = await this.repo.findingsForRunIds(runIds);
    const byRunId = new Map(findingsByRunId.map((f) => [f.runId, f]));

    const derivableRuns: DerivableRun[] = children.map((c) => {
      const match = byRunId.get(c.run.id);
      const agentId = c.run.agentId ?? c.run.id;
      const agentName = c.agentName ?? 'Deleted agent';
      return {
        run_id: c.run.id,
        agent_id: agentId,
        agent_name: agentName,
        status: toColumnStatus(c.run.status),
        findings: (match?.findings ?? []).map((row) => ({
          id: row.id,
          run_id: c.run.id,
          agent_id: agentId,
          agent_name: agentName,
          file: row.file,
          start_line: row.startLine,
          end_line: row.endLine,
          category: row.category,
          severity: row.severity as Severity,
          title: row.title,
          rationale: row.rationale,
          suggestion: row.suggestion,
          confidence: row.confidence,
        })),
      };
    });

    const groups = deriveFindingGroups(derivableRuns);
    const conflicts = deriveConflicts(derivableRuns);

    const columns: AgentColumn[] = children.map((c) => {
      const match = byRunId.get(c.run.id);
      const review = match?.review;
      const findings: AgentColumnFinding[] = (match?.findings ?? []).map((row) => ({
        id: row.id,
        severity: row.severity as Severity,
        category: row.category,
        title: row.title,
        file: row.file,
        start_line: row.startLine,
        kind: row.kind,
      }));
      const status = toColumnStatus(c.run.status);
      // `AgentColumn.error` (fix for the original gap noted in this file's
      // history) carries the persisted `agent_runs.error` text directly —
      // `summary` is never overloaded with it, so it only ever holds a
      // genuine review summary.
      const error = status === 'failed' || status === 'cancelled' ? (c.run.error ?? null) : null;
      return {
        run_id: c.run.id,
        agent_id: c.run.agentId ?? c.run.id,
        agent_name: c.agentName ?? 'Deleted agent',
        provider: c.run.provider,
        model: c.run.model,
        status,
        verdict: review?.verdict ?? null,
        score: c.run.score,
        summary: review?.summary ?? null,
        error,
        duration_ms: c.run.durationMs,
        cost_usd: c.run.costUsd,
        findings,
      };
    });

    const result: MultiAgentRun = {
      id: parent.id,
      pr_id: parent.prId,
      pr_number: pull?.number ?? null,
      ran_at: parent.ranAt.toISOString(),
      agent_count: children.length,
      total_duration_ms: totalDurationMs(children),
      total_cost_usd: totalCostUsd(children),
      total_cost_partial: children.some((c) => c.run.costUsd == null),
      columns,
      groups,
      conflicts,
    };
    return MultiAgentRun.parse(result);
  }
}

/** `agent_runs.status` is an untyped `text` column at the DB level (no CHECK
 *  constraint); the app only ever writes one of these four values, but the
 *  cast is made explicit and defensive here rather than assumed. */
function toColumnStatus(status: string | null): AgentColumn['status'] {
  if (status === 'done' || status === 'failed' || status === 'running' || status === 'cancelled') {
    return status;
  }
  return 'failed';
}

/**
 * Wall-clock span: first child START → last child FINISH — NOT a sum of
 * per-child durations. A child without a known duration (still `running`, or
 * a reaped-stale child whose `durationMs` was never set — `reapStaleRunningRuns`
 * only flips `status`) contributes "now" as its provisional finish, so the
 * span keeps growing while the batch is in flight instead of looking done.
 */
function totalDurationMs(children: { run: { ranAt: Date; durationMs: number | null } }[]): number {
  const starts = children.map((c) => c.run.ranAt.getTime());
  const finishes = children.map((c) =>
    c.run.durationMs != null ? c.run.ranAt.getTime() + c.run.durationMs : Date.now(),
  );
  return Math.max(0, Math.max(...finishes) - Math.min(...starts));
}

/** Sum of every child's `cost_usd` (nulls treated as 0 in the sum; their
 *  presence is what makes `total_cost_partial` true — see the caller). */
function totalCostUsd(children: { run: { costUsd: number | null } }[]): number | null {
  const known = children.filter((c) => c.run.costUsd != null);
  if (known.length === 0) return null;
  return known.reduce((sum, c) => sum + (c.run.costUsd ?? 0), 0);
}
