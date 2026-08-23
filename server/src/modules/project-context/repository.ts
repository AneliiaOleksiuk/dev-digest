/**
 * Project Context data-access port. Interface + plain types only — no
 * Drizzle imports (mirrors `modules/blast/repository.ts`).
 *
 * Every method takes `workspaceId` explicitly and filters on it (A01):
 * attaching a document of repo A to an agent of workspace B must 404, not
 * succeed. `surfaceId` is polymorphic (a skill or agent id) and carries no
 * FK (R-D of docs/plans/spec-01-project-context.md) — callers (routes.ts)
 * are responsible for verifying the referenced skill/agent belongs to
 * `workspaceId` before calling `replaceFor`.
 */

export type ContextSurface = 'skill' | 'agent';

export interface ContextAttachmentRow {
  path: string;
  order: number;
}

/** One row of an agent's effective (direct ∪ enabled-skill) attachment set,
 *  before the service's dedupe (AC-14). */
export interface EffectiveAttachmentRow {
  path: string;
  order: number;
  source: 'agent' | 'skill';
  /** Name of the skill this row came through (undefined for direct rows) —
   *  lets a consumer label an inherited document with its source skill. */
  skillName?: string;
  /** Skill enabled flag. SQL already filters `enabled = true` for skill
   *  rows; the service also skips `source === 'skill' && enabled === false`
   *  as defense-in-depth for AC-15. Direct agent rows omit this or set true. */
  enabled?: boolean;
}

export interface ContextRepoRow {
  id: string;
  clonePath: string | null;
}

export interface ContextRepository {
  /** Workspace-scoped repo lookup (clone path drives the E-1 degraded case). */
  getRepo(workspaceId: string, repoId: string): Promise<ContextRepoRow | undefined>;

  /** A surface's own attached documents FOR ONE REPO, in persisted order.
   *  `repoId` is required (not in the plan's original signature — added
   *  because a surface may hold attachments against several repos at once,
   *  E-8, so an unscoped read can't be correctly rendered on a single-repo
   *  Context tab). */
  listFor(
    workspaceId: string,
    surface: ContextSurface,
    surfaceId: string,
    repoId: string,
  ): Promise<ContextAttachmentRow[]>;

  /** Every attachment row for that surface across all repos in the
   *  workspace, ordered by repo then order (E-8 / WI11). */
  listForAll(
    workspaceId: string,
    surface: ContextSurface,
    surfaceId: string,
  ): Promise<{ path: string; order: number; repoId: string }[]>;

  /** Replace the whole attached set for one surface (delete + insert in
   *  order — AC-13's ordering is the array index). Idempotent no-op when
   *  `paths` is empty (clears the set). */
  replaceFor(
    workspaceId: string,
    surface: ContextSurface,
    surfaceId: string,
    repoId: string,
    paths: string[],
  ): Promise<ContextAttachmentRow[]>;

  /** Agent-direct ∪ enabled-linked-skill attachments for one agent/repo —
   *  NOT deduped (the service dedupes by path, keeping the lowest order,
   *  per D-1/AC-14). Mirrors the enabled-only rule at
   *  `run-executor.ts:228-229` ("linking ≠ trusting"). */
  listForAgentEffective(
    workspaceId: string,
    agentId: string,
    repoId: string,
  ): Promise<EffectiveAttachmentRow[]>;

  /** Agent-direct ∪ enabled-linked-skill attachments whose `repo_id` is
   *  NOT `repoId` (E-8). Same enabled-only rule as `listForAgentEffective`.
   *  Paths only ever leave this layer — never content (A09). Not injected. */
  listMismatchedForAgent(
    workspaceId: string,
    agentId: string,
    repoId: string,
  ): Promise<{ path: string; repoId: string }[]>;

  /** Per-path count of distinct agents (direct + enabled-skill-inherited)
   *  that would inject each document in this repo (AC-8). */
  usageCountsByPath(workspaceId: string, repoId: string): Promise<Map<string, number>>;

  /** Every path attached to ANY surface (skill or agent) in this repo,
   *  regardless of enabled/disabled — used by `listDocuments` to surface an
   *  attached-but-deleted-from-disk document as `missing: true` (E-2), even
   *  though the discovery walk itself can never find it. */
  distinctAttachedPaths(workspaceId: string, repoId: string): Promise<string[]>;

  /** Delete every attachment row for one surface — called from
   *  `AgentsService.delete`/`SkillsService.delete` so a deleted surface
   *  never orphans attachment rows (R-D(b)). */
  deleteForSurface(workspaceId: string, surface: ContextSurface, surfaceId: string): Promise<void>;
}
