import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { Finding, Intent, PrIntentRecord, RunSummary, RunTrace } from '@devdigest/shared';
import type { UpsertIntentInput } from './repository/pull.repo.js';

/**
 * A2 — review data-access. The ONLY layer touching the DB for the review
 * domain. Owns `reviews`, `findings`, `pr_intent`, and persists the
 * observability rows `agent_runs` + `run_traces` (one trace doc per run).
 * Workspace scoping is enforced via the PR (which carries workspace_id).
 *
 * The query implementations are colocated, split by aggregate, under
 * `./repository/` (review+findings, agent runs, pull/intent). This class
 * composes them so its public API stays identical.
 */

import type { FindingRow, PullRow } from '../../db/rows.js';
export type { FindingRow, PullRow };

export type ReviewRow = typeof t.reviews.$inferSelect;

import * as reviewRepo from './repository/review.repo.js';
import * as runRepo from './repository/run.repo.js';
import * as pullRepo from './repository/pull.repo.js';
import * as knowledgeRepo from './repository/knowledge.repo.js';
import type { MemoryKind, MemoryScope, MemorySource } from '@devdigest/shared';
import type { MultiAgentRunRow, AgentRunRow } from './repository/run.repo.js';
import type {
  MemoryRow,
  EvalCaseRow,
  EvalCaseOwnerKind,
} from './repository/knowledge.repo.js';
export type { MultiAgentRunRow, AgentRunRow, MemoryRow, EvalCaseRow, EvalCaseOwnerKind };

export class ReviewRepository {
  constructor(private db: Db) {}

  // ---- PR lookup (workspace-scoped) --------------------------------------

  getPull(workspaceId: string, prId: string): Promise<PullRow | undefined> {
    return pullRepo.getPull(this.db, workspaceId, prId);
  }

  getRepo(repoId: string): Promise<typeof t.repos.$inferSelect | undefined> {
    return pullRepo.getRepo(this.db, repoId);
  }

  getPrFiles(prId: string): Promise<(typeof t.prFiles.$inferSelect)[]> {
    return pullRepo.getPrFiles(this.db, prId);
  }

  // ---- reviews + findings -------------------------------------------------

  insertReview(values: {
    workspaceId: string;
    prId: string;
    agentId: string | null;
    runId: string | null;
    kind: 'summary' | 'review';
    verdict: string | null;
    summary: string | null;
    score: number | null;
    model: string | null;
  }): Promise<ReviewRow> {
    return reviewRepo.insertReview(this.db, values);
  }

  insertFindings(reviewId: string, findings: Finding[]): Promise<FindingRow[]> {
    return reviewRepo.insertFindings(this.db, reviewId, findings);
  }

  /** Reviews for a PR (newest first), each with its findings. */
  reviewsForPull(prId: string): Promise<{ review: ReviewRow; findings: FindingRow[] }[]> {
    return reviewRepo.reviewsForPull(this.db, prId);
  }

  getReview(reviewId: string): Promise<ReviewRow | undefined> {
    return reviewRepo.getReview(this.db, reviewId);
  }

  /** In-flight runs for a PR (status='running') — the server-side source of
   *  truth for "which agents are running now". Joined with the agent name. */
  activeRunsForPull(
    workspaceId: string,
    prId: string,
  ): Promise<{ run_id: string; agent_id: string | null; agent_name: string | null; ran_at: string | null }[]> {
    return runRepo.activeRunsForPull(this.db, workspaceId, prId);
  }

  /** All runs for a PR (any status), newest first — the PR run history. */
  listRunsForPull(workspaceId: string, prId: string): Promise<RunSummary[]> {
    return runRepo.listRunsForPull(this.db, workspaceId, prId);
  }

  /** Delete one agent run (+ its trace via FK cascade). Workspace-scoped. */
  deleteAgentRun(workspaceId: string, runId: string): Promise<boolean> {
    return runRepo.deleteAgentRun(this.db, workspaceId, runId);
  }

  /** Mark a still-running run as cancelled (no-op if it already finished). */
  cancelRunIfRunning(runId: string): Promise<boolean> {
    return runRepo.cancelRunIfRunning(this.db, runId);
  }

  /** On boot: any run still 'running' is orphaned (its process died / restarted),
   *  so mark it failed. Prevents permanently stuck "running" runs in the UI. */
  reapStaleRunningRuns(): Promise<number> {
    return runRepo.reapStaleRunningRuns(this.db);
  }

  /** Delete a whole review (one agent's run) + its findings (cascade), scoped
   *  to the workspace. Returns false if not found in the workspace. */
  deleteReview(workspaceId: string, reviewId: string): Promise<boolean> {
    return reviewRepo.deleteReview(this.db, workspaceId, reviewId);
  }

  // ---- finding actions ----------------------------------------------------

  getFinding(findingId: string): Promise<FindingRow | undefined> {
    return reviewRepo.getFinding(this.db, findingId);
  }

  /** Resolve workspace_id + pr_id for a finding (via review → pr). */
  findingContext(
    findingId: string,
  ): Promise<{ finding: FindingRow; review: ReviewRow; pull: PullRow } | undefined> {
    return reviewRepo.findingContext(this.db, findingId);
  }

  setFindingAccepted(findingId: string, at: Date | null): Promise<FindingRow | undefined> {
    return reviewRepo.setFindingAccepted(this.db, findingId, at);
  }

  setFindingDismissed(findingId: string, at: Date | null): Promise<FindingRow | undefined> {
    return reviewRepo.setFindingDismissed(this.db, findingId, at);
  }

  // ---- intent -------------------------------------------------------------

  upsertIntent(prId: string, intent: UpsertIntentInput): Promise<void> {
    return pullRepo.upsertIntent(this.db, prId, intent);
  }

  getIntent(prId: string): Promise<Intent | undefined> {
    return pullRepo.getIntent(this.db, prId);
  }

  /** Full persisted record (incl. head_sha/provider/model/classified_at) for
   *  the API route and the "stale, re-run?" comparison. */
  getIntentRecord(prId: string): Promise<PrIntentRecord | undefined> {
    return pullRepo.getIntentRecord(this.db, prId);
  }

  // ---- observability: agent_runs + run_traces ----------------------------

  /** Create an agent_runs row in `running` state; returns its id (= the runId). */
  createAgentRun(values: {
    workspaceId: string;
    agentId: string | null;
    prId: string;
    provider: string | null;
    model: string | null;
    multiAgentRunId?: string | null;
  }): Promise<string> {
    return runRepo.createAgentRun(this.db, values);
  }

  // ---- multi-agent batches (L07, SPEC-04) --------------------------------

  createMultiAgentRun(values: { workspaceId: string; prId: string }): Promise<string> {
    return runRepo.createMultiAgentRun(this.db, values);
  }

  getMultiAgentRun(workspaceId: string, id: string): Promise<MultiAgentRunRow | undefined> {
    return runRepo.getMultiAgentRun(this.db, workspaceId, id);
  }

  listChildRuns(
    workspaceId: string,
    multiAgentRunId: string,
  ): Promise<{ run: AgentRunRow; agentName: string | null }[]> {
    return runRepo.listChildRuns(this.db, workspaceId, multiAgentRunId);
  }

  /** Findings for a set of run ids, via `reviews.runId` (batch column read). */
  findingsForRunIds(
    runIds: string[],
  ): Promise<{ runId: string; review: ReviewRow; findings: FindingRow[] }[]> {
    return reviewRepo.findingsForRunIds(this.db, runIds);
  }

  /** Per-agent avg duration + avg cost for EVERY agent id given, in ONE
   *  query (fix-loop iteration 1 — replaces the former N+1
   *  `avgStatsForAgentModel`, called once per agent). Grouped by
   *  `(agent_id, model)`; the caller matches each agent's own current model. */
  avgStatsForAgents(
    workspaceId: string,
    agentIds: string[],
  ): Promise<
    { agentId: string; model: string | null; avgDurationMs: number | null; avgCostUsd: number | null; sampleSize: number }[]
  > {
    return runRepo.avgStatsForAgents(this.db, workspaceId, agentIds);
  }

  // ---- Learn → memory / Turn into eval case (L07, SPEC-04) ---------------

  insertMemory(values: {
    workspaceId: string;
    repoId: string | null;
    scope: MemoryScope;
    kind: MemoryKind;
    content: string;
    confidence: number | null;
    sources: MemorySource[];
    learnedFindingId?: string | null;
  }): Promise<MemoryRow> {
    return knowledgeRepo.insertMemory(this.db, values);
  }

  /** Idempotency lookup for the Learn action (AC-39) — see
   *  `knowledge.repo.ts`'s `findMemoryByLearnedFinding` for the contract. */
  findMemoryByLearnedFinding(workspaceId: string, findingId: string): Promise<MemoryRow | undefined> {
    return knowledgeRepo.findMemoryByLearnedFinding(this.db, workspaceId, findingId);
  }

  findEvalCaseByOwner(
    workspaceId: string,
    ownerKind: EvalCaseOwnerKind,
    ownerId: string,
  ): Promise<EvalCaseRow | undefined> {
    return knowledgeRepo.findEvalCaseByOwner(this.db, workspaceId, ownerKind, ownerId);
  }

  insertEvalCase(values: {
    workspaceId: string;
    ownerKind: EvalCaseOwnerKind;
    ownerId: string;
    name: string;
    inputDiff: string | null;
    inputFiles: unknown;
    inputMeta: unknown;
    expectedOutput: unknown;
  }): Promise<EvalCaseRow> {
    return knowledgeRepo.insertEvalCase(this.db, values);
  }

  completeAgentRun(
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
    return runRepo.completeAgentRun(this.db, runId, values);
  }

  /** Record the head SHA a review ran against (PR-list freshness derivation). */
  markReviewed(prId: string, sha: string): Promise<void> {
    return pullRepo.markReviewed(this.db, prId, sha);
  }

  /** Persist the WHOLE run log as ONE document. PK = runId → agent_runs. */
  saveRunTrace(runId: string, trace: RunTrace): Promise<void> {
    return runRepo.saveRunTrace(this.db, runId, trace);
  }

  getRunTrace(runId: string): Promise<RunTrace | undefined> {
    return runRepo.getRunTrace(this.db, runId);
  }
}
