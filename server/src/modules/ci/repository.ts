/**
 * CI module data-access port. Interface + plain types only — no Drizzle
 * imports (mirrors `modules/blast/repository.ts`, `modules/eval/repository.ts`).
 * `repository.drizzle.ts` is the only file in this module that touches
 * `db/schema`.
 *
 * TENANCY (A01): `ci_installations` carries NO `workspace_id` column of its
 * own (`db/schema/ci.ts`) — every method below that takes a `workspaceId`
 * joins through `agents.workspace_id` to enforce it. The exception is
 * `findInstallationByTokenHash`, used only by the ingest path
 * (`POST /ci/ingest`) BEFORE tenancy is known — the presented token is what
 * proves which installation (and therefore which workspace) the caller may
 * write into, so it resolves and RETURNS `workspaceId` with the row rather
 * than accepting it, and every other ingest-path operation is scoped from
 * that resolved value (never from `getContext`, AC-52). `agent_runs` (unlike
 * `ci_installations`) already
 * carries its own `workspace_id` column (`db/schema/runs.ts`, added Phase A)
 * — `insertCiRun`/`listCiRuns` scope directly off that column, no `agents`
 * join needed for those two.
 */

// ---- shared literal unions (mirrors the DB enums; kept local rather than
// importing from '@devdigest/shared' so this port stays fully self-contained,
// same pattern `modules/eval/repository.ts` already uses) --------------------

export type CiTargetType = 'gha' | 'circle' | 'jenkins' | 'cli';
export type CiPostAs = 'github_review' | 'pr_comment' | 'none';

/** A persisted `ci_installations` row. */
export interface CiInstallationRow {
  id: string;
  agentId: string;
  repo: string;
  targetType: CiTargetType;
  installedAt: Date;
  /** sha256(token), hex — the plaintext token is NEVER stored (AC-50). */
  tokenHash: string;
  ingestUrl: string;
  workflowVersion: number;
  agentVersion: number;
  postAs: CiPostAs;
  triggers: string[];
  baseBranch: string;
  /**
   * Fix (finding 2): a STABLE, persisted path for this installation's
   * manifest under `.devdigest/agents/` — set once (fresh install, or
   * inherited from a replaced installation on a confirmed conflict) and
   * reused on every later re-export, never re-derived from the agent's
   * CURRENT name. See `db/schema/ci.ts`'s `manifestPath` doc comment for the
   * bug this closes.
   */
  manifestPath: string;
  updatedAt: Date;
}

/** Nullable summary of the most recent CI run for an installation (AC-43). */
export interface CiLastRunSummary {
  ranAt: Date;
  status: string;
  findingsCount: number | null;
}

export interface CiInstallationWithLastRun extends CiInstallationRow {
  lastRun: CiLastRunSummary | null;
}

/** `findInstallationByTokenHash`'s return shape — the row PLUS its resolved
 *  workspace, so the ingest path can never forget to scope off it (AC-52). */
export interface CiInstallationWithWorkspace extends CiInstallationRow {
  workspaceId: string;
}

export interface UpsertInstallationInput {
  agentId: string;
  repo: string;
  targetType: CiTargetType;
  ingestUrl: string;
  workflowVersion: number;
  agentVersion: number;
  postAs: CiPostAs;
  triggers: string[];
  baseBranch: string;
  /** Fix (finding 2) — see `CiInstallationRow.manifestPath`'s doc comment.
   *  The caller (service.ts) has already resolved the correct value for
   *  this export (fresh slug-derived path / inherited from a replaced
   *  installation / reused from `existing.manifestPath`) before calling
   *  this method — this field just persists whatever was resolved. */
  manifestPath: string;
  /**
   * Used ONLY when this call performs a genuine INSERT (no existing row for
   * this `(agentId, repo)` pair). On an UPDATE (the row already exists), the
   * Drizzle adapter's `onConflictDoUpdate` `set` clause deliberately OMITS
   * `tokenHash` entirely — so whatever value is passed here is structurally
   * incapable of overwriting an existing token hash on update (AC-38,
   * UX-12), regardless of what a caller passes. Callers should still pass
   * the existing row's own hash on an update, for clarity, but the
   * guarantee does not depend on that discipline.
   */
  tokenHash: string;
}

/** One CI run to record — every field explicit, nothing spread from the
 *  ingest request body (A08). `workspaceId`/`agentId` are DATA carried on
 *  the row (resolved by the caller from `findInstallationByTokenHash`, never
 *  re-derived here) — this method does not use them to SCOPE the write the
 *  way every other method's `workspaceId` parameter does, which is why it is
 *  the second of the two ingest-path exceptions named in this file's module
 *  docblock. */
export interface InsertCiRunInput {
  workspaceId: string;
  agentId: string | null;
  ciInstallationId: string;
  repo: string;
  externalPrNumber: number | null;
  headSha: string;
  actionsRunId: string;
  jobUrl: string;
  sourceLabel: string;
  status: string;
  findingsCount: number | null;
  critical: number | null;
  warning: number | null;
  suggestion: number | null;
  costUsd: number | null;
  durationMs: number | null;
  error: string | null;
}

/** Filters for `GET /ci/runs`, applied AFTER the workspace predicate
 *  (AC-63, AC-75) — never instead of it. `sourceLabel` filters the
 *  free-form, unvalidated `source` label reported by the CI job (D-13,
 *  AC-62), distinct from the DB `source` enum column (always `'ci'` for
 *  every row this method returns). */
export interface CiRunFilterInput {
  sinceDays: number;
  agentId?: string | null;
  repo?: string | null;
  status?: string | null;
  sourceLabel?: string | null;
}

/** One `agent_runs` row (source='ci') joined with its agent's name (nullable
 *  — an orphaned run whose agent was deleted must still return, E-24) and,
 *  where a local `pull_requests` row happens to exist for the same repo +
 *  external PR number, its title (AC-56, E-25). */
export interface CiRunListRow {
  id: string;
  ciInstallationId: string | null;
  agentId: string | null;
  agentName: string | null;
  repo: string | null;
  externalPrNumber: number | null;
  headSha: string | null;
  ranAt: Date | null;
  status: string | null;
  findingsCount: number | null;
  critical: number | null;
  warning: number | null;
  suggestion: number | null;
  costUsd: number | null;
  durationMs: number | null;
  jobUrl: string | null;
  sourceLabel: string | null;
  prTitle: string | null;
}

export interface CiRepository {
  // ---- installations (workspace-scoped via the `agents` join) -------------

  /** An agent's installations (one per exported repo), each with its
   *  last-run summary (AC-43). */
  listInstallationsForAgent(workspaceId: string, agentId: string): Promise<CiInstallationWithLastRun[]>;

  /** The installation for this exact `(agent, repo)` pair, if any — drives
   *  the "update, keep the token" branch of Install (AC-38). */
  findInstallationByAgentAndRepo(
    workspaceId: string,
    agentId: string,
    repo: string,
  ): Promise<CiInstallationRow | undefined>;

  /** Every installation for this repo in this workspace, regardless of
   *  agent — drives AC-39's different-agent conflict check. */
  findInstallationsByRepo(workspaceId: string, repo: string): Promise<CiInstallationRow[]>;

  /** Create-or-update keyed on the `(agent_id, repo)` unique index. See
   *  `UpsertInstallationInput.tokenHash`'s doc comment for the "never
   *  overwrites on update" guarantee. */
  upsertInstallation(input: UpsertInstallationInput): Promise<CiInstallationRow>;

  /** Workspace-scoped delete (Q-6, WI16). `agent_runs.ci_installation_id` is
   *  `ON DELETE SET NULL` — past CI runs stay readable (E-24's precedent). */
  deleteInstallation(workspaceId: string, id: string): Promise<boolean>;

  // ---- ingest-path exception (see module docblock) --------------------------

  /**
   * Fix (finding 1) — the ingest endpoint's actual authentication path.
   * `hash` is `sha256(presentedToken)`, computed by the caller BEFORE this
   * call. The lookup itself IS the authentication: a hash match proves
   * possession of the token (there is no separate "installation is
   * unknown" step to fold in — an unmatched hash simply returns no row,
   * which the caller treats as 401). Returns the row with its resolved
   * `workspaceId`, same shape as `findInstallationById`, for the same
   * reason (AC-52).
   */
  findInstallationByTokenHash(hash: string): Promise<CiInstallationWithWorkspace | undefined>;

  /** Idempotent on the `(ci_installation_id, actions_run_id)` unique index —
   *  a conflict is a no-op SUCCESS (returns normally), never a thrown error
   *  (AC-57, E-16). */
  insertCiRun(row: InsertCiRunInput): Promise<void>;

  // ---- CI Runs list (workspace-scoped directly off `agent_runs`) ----------

  /** `source = 'ci'` only, never local runs (AC-65). Filters applied AFTER
   *  the workspace predicate (AC-63, AC-75). */
  listCiRuns(workspaceId: string, filters: CiRunFilterInput): Promise<CiRunListRow[]>;
}
