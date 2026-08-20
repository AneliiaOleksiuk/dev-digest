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
}
