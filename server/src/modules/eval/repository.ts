/**
 * Eval data-access port. Interface + plain types only — no Drizzle imports
 * (mirrors `modules/blast/repository.ts`). `repository.drizzle.ts` is the
 * only file in this module that touches `db/schema`.
 *
 * Two responsibilities live behind this one port:
 *  - `eval_cases` CRUD, workspace-scoped (WI4).
 *  - a finding → review → pull → workspace read for "create case from
 *    finding" (WI5) — this module's OWN re-implementation of the join
 *    `modules/reviews/repository.ts`'s `findingContext` performs, per the
 *    onion-architecture "Cross-module reads" rule (never import another
 *    module's repository.ts/repository.drizzle.ts directly).
 */

/** `owner_kind` accepted at the API/DB level. D-9: the enum keeps `'skill'`
 *  too (Phase-A contract), but only `'agent'` is ever written this iteration. */
export type EvalCaseOwnerKind = 'skill' | 'agent';

/** A persisted `eval_cases` row (raw — `expected_output` is unparsed jsonb;
 *  `helpers.ts`'s `mapRowToRecord` re-parses it against `EvalExpectation`
 *  and degrades to `expectation_status: 'unusable'` on failure). */
export interface EvalCaseRow {
  id: string;
  workspaceId: string;
  ownerKind: EvalCaseOwnerKind;
  ownerId: string;
  name: string;
  inputDiff: string | null;
  inputFiles: unknown;
  inputMeta: unknown;
  expectedOutput: unknown;
  notes: string | null;
}

export interface EvalCaseInsert {
  workspaceId: string;
  /** D-9 — always `'agent'` this iteration; the column still allows `'skill'`. */
  ownerKind: EvalCaseOwnerKind;
  ownerId: string;
  name: string;
  inputDiff: string;
  inputFiles?: unknown;
  inputMeta?: unknown;
  expectedOutput: unknown;
  notes?: string | null;
}

export interface EvalCaseUpdate {
  ownerId?: string;
  name?: string;
  inputDiff?: string;
  inputFiles?: unknown;
  inputMeta?: unknown;
  expectedOutput?: unknown;
  notes?: string | null;
}

/** One `findings` row, narrowed to the fields WI5 needs. */
export interface EvalFindingRow {
  id: string;
  reviewId: string;
  file: string;
  startLine: number;
  endLine: number;
  severity: string;
  category: string;
  title: string;
  kind: string;
  acceptedAt: Date | null;
  dismissedAt: Date | null;
}

/** One `reviews` row, narrowed to the fields WI5 needs. */
export interface EvalReviewRow {
  id: string;
  agentId: string | null;
  prId: string;
}

/** One `pull_requests` row, narrowed to the fields WI5 needs. */
export interface EvalPullRow {
  id: string;
  workspaceId: string;
  title: string;
  body: string | null;
}

export interface EvalFindingContext {
  finding: EvalFindingRow;
  review: EvalReviewRow;
  pull: EvalPullRow;
}

/** One `pr_files` row, narrowed to the fields WI5 needs. */
export interface EvalPrFileRow {
  path: string;
  patch: string | null;
}

// ---- batch runner (WI7) / read APIs (WI8) ----------------------------------

/**
 * Everything needed to insert a batch row ALREADY CLOSED with its final
 * aggregate — pin fields captured at batch-OPEN time (AC-15/AC-16: agent
 * config as of the moment the batch started, before any case ran) plus the
 * aggregate computed once every case has actually run (AC-19, AC-21, AC-30;
 * never zeros for an all-failed batch, `null` metrics instead).
 *
 * There is deliberately no separate "open with placeholder aggregates, then
 * close" step (an earlier draft of this module had one — `status: 'failed'`,
 * every count 0, every metric null, written before any case ran). That
 * placeholder had no way to be excluded from `listBatchesForOwner` (no status
 * filter, sorted `ran_at` desc), so it WAS `batches[0]` — the "latest" batch
 * — for the entire in-flight window: a concurrent
 * `GET /agents/:id/eval-dashboard` during a run saw `current.*` all null and
 * `cases_total: 0` for an agent with real history, and computed a fabricated
 * `delta` against it. Deferring the whole write to here means a running
 * batch simply has no row at all until it's done — nothing for any read path
 * to pick up — and a process that dies mid-batch leaves no row, rather than
 * a permanent fake-failed one indistinguishable from a genuine AC-21
 * all-failed batch.
 *
 * `EvalRepository.insertBatchWithRuns` (the only port method that accepts
 * this type) writes this row plus every per-case `eval_runs` row it produces
 * inside ONE transaction, so a closed batch's `cases_total` can no longer
 * diverge from its actual persisted `eval_runs` count (Phase C fix-loop
 * iteration 2, Minor finding #1). That guarantee only covers what the
 * transaction itself commits, though: if the process crashes WHILE the batch
 * is still running -- i.e. before this transaction even starts -- any spend
 * already incurred by cases that already completed has no persisted record
 * anywhere and cannot be recovered; this is an accepted tradeoff of
 * deferring all persistence to batch-end, not a claim that no spend can ever
 * be lost (Minor finding #2).
 */
export interface EvalBatchWrite {
  workspaceId: string;
  ownerKind: EvalCaseOwnerKind;
  ownerId: string;
  agentVersion: number;
  provider: string;
  model: string;
  skillsFingerprint: { skill_id: string; version: number }[];
  /** Captured at batch-OPEN time (before any case ran), NOT at insert time —
   *  so `ran_at` still reflects when the batch started, matching the earlier
   *  open-then-close shape's semantics even though the write itself now
   *  happens after every case has run. */
  ranAt: Date;
  status: 'completed' | 'failed';
  casesTotal: number;
  casesPassed: number;
  casesFailed: number;
  recall: number | null;
  recallCases: number;
  precision: number | null;
  precisionCases: number;
  citationAccuracy: number | null;
  citationCases: number;
  findingsTotal: number | null;
  durationMs: number | null;
  costUsd: number | null;
  error: string | null;
}

/** A persisted `eval_batches` row (raw — `skillsFingerprint` is unparsed
 *  jsonb; `helpers.ts`'s `mapBatchRowToRecord` re-parses it, degrading to an
 *  empty array on failure, same "degrade rather than throw" pattern
 *  `mapRowToRecord` already established for `expected_output`, A08). */
export interface EvalBatchRow {
  id: string;
  workspaceId: string;
  ownerKind: EvalCaseOwnerKind;
  ownerId: string;
  agentVersion: number;
  provider: string;
  model: string;
  skillsFingerprint: unknown;
  ranAt: Date;
  status: 'completed' | 'failed';
  casesTotal: number;
  casesPassed: number;
  casesFailed: number;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  recallCases: number;
  precisionCases: number;
  citationCases: number;
  findingsTotal: number | null;
  durationMs: number | null;
  costUsd: number | null;
  error: string | null;
}

/** One `eval_runs` insert — persisted per case once the runner has an
 *  outcome (AC-19). `batchId` is always supplied by this module's callers
 *  (never null on insert — it only reads back as nullable after a batch row
 *  is later deleted, `ON DELETE SET NULL`). */
export interface EvalRunInsert {
  caseId: string;
  batchId: string;
  actualOutput: unknown;
  pass: boolean | null;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  findingsTotal: number | null;
  durationMs: number | null;
  costUsd: number | null;
  error: string | null;
}

/** A persisted `eval_runs` row (raw). */
export interface EvalRunRow {
  id: string;
  caseId: string;
  batchId: string | null;
  ranAt: Date;
  actualOutput: unknown;
  pass: boolean | null;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  findingsTotal: number | null;
  durationMs: number | null;
  costUsd: number | null;
  error: string | null;
}

export interface EvalRepository {
  // ---- eval_cases CRUD (WI4) ----------------------------------------------

  listForAgent(workspaceId: string, agentId: string): Promise<EvalCaseRow[]>;

  getById(workspaceId: string, id: string): Promise<EvalCaseRow | undefined>;

  insert(values: EvalCaseInsert): Promise<EvalCaseRow>;

  /** Workspace-scoped update. Returns `undefined` when the row isn't in this
   *  workspace (the route/service maps that to 404, never a 403-with-detail). */
  update(workspaceId: string, id: string, patch: EvalCaseUpdate): Promise<EvalCaseRow | undefined>;

  /** Workspace-scoped delete. Returns `false` when the row isn't in this workspace. */
  deleteById(workspaceId: string, id: string): Promise<boolean>;

  // ---- create-from-finding read path (WI5) --------------------------------

  /** Resolve finding → review → pull, for the tenancy check + the
   *  server-derived expectation kind/owner/match_scope. Returns `undefined`
   *  when the finding (or its review/pull) doesn't exist — the CALLER checks
   *  `pull.workspaceId` against the caller's own workspace (AC-5's 404). */
  getFindingContext(findingId: string): Promise<EvalFindingContext | undefined>;

  /** The `pr_files` row for one path in one PR — used to pin `input_diff` at
   *  case-creation time (AC-7/AC-8). `undefined`/`patch: null` both mean "no
   *  usable patch" to the caller. */
  getPrFileByPath(prId: string, path: string): Promise<EvalPrFileRow | undefined>;

  // ---- batch runner (WI7) --------------------------------------------------

  /** The ONLY write to `eval_batches`/`eval_runs` for a run — inserts the
   *  batch row already CLOSED with its final aggregate (see `EvalBatchWrite`'s
   *  doc comment for why there is no separate open/close step) plus every
   *  one of `runs`' per-case outcomes (AC-19/AC-20), all inside a SINGLE
   *  transaction: a throw/crash between the batch insert and the run inserts
   *  can no longer leave a closed batch whose `cases_total` doesn't match its
   *  actual `eval_runs` row count (Phase C fix-loop iteration 2, Minor
   *  finding #1 -- see `EvalBatchWrite`'s doc comment for the residual risk
   *  this does NOT cover). `runs` omits `batchId` -- the real batch id only
   *  exists once the transaction's first insert returns, so the
   *  implementation fills it in for every row itself. */
  insertBatchWithRuns(
    batch: EvalBatchWrite,
    runs: Omit<EvalRunInsert, 'batchId'>[],
  ): Promise<{ batch: EvalBatchRow; runs: EvalRunRow[] }>;

  // ---- read APIs (WI8, zero LLM calls) -------------------------------------

  /** Workspace-scoped batch read (AC-44) — `undefined` when the batch isn't
   *  in this workspace, mapped by the caller to a 404. */
  getBatchById(workspaceId: string, id: string): Promise<EvalBatchRow | undefined>;

  /** An owner's batches, most recent first. `limit` caps history-table reads;
   *  omitted for the dashboard, which needs the full set for delta + trend. */
  listBatchesForOwner(workspaceId: string, ownerId: string, limit?: number): Promise<EvalBatchRow[]>;

  /** Every `eval_runs` row for one batch, plus its source case's CURRENT name
   *  (left-joined — `case_name` reads back `null` if the case row is somehow
   *  gone, even though the FK's `ON DELETE CASCADE` on `eval_cases` normally
   *  prevents that). `batchId` is trusted here because every caller already
   *  resolved it through `getBatchById` (workspace-scoped) first — AC-44. */
  listRunsForBatch(batchId: string): Promise<{ run: EvalRunRow; caseName: string | null }[]>;

  /** Distinct `(owner_kind, owner_id)` pairs with EITHER a case OR a batch in
   *  this workspace — the "one entry per agent" set the workspace-wide
   *  dashboard route iterates (an owner keeps showing up in its own history
   *  even after every one of its cases has been deleted, E-15). */
  listDashboardOwnerIds(workspaceId: string): Promise<{ ownerKind: EvalCaseOwnerKind; ownerId: string }[]>;

  /** `eval_cases` count for one owner in this workspace — `EvalDashboard.cases_total`. */
  countCasesForOwner(workspaceId: string, ownerId: string): Promise<number>;
}
