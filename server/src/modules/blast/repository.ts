/**
 * Blast data-access port. Reads `pull_requests` (workspace-scoped existence
 * check + `repoId`) and `pr_files` (changed paths). Interface + plain types
 * only — no Drizzle imports (mirrors `smart-diff/repository.ts`).
 */

export interface BlastPull {
  id: string;
  repoId: string;
}

/** One prior PR that overlaps ≥1 of this PR's changed file paths. */
export interface PriorPrRow {
  id: string;
  number: number;
  title: string;
  author: string;
  overlappingFiles: number;
}

export interface BlastRepository {
  /** Workspace-scoped existence check (drives the 404) — also yields `repoId`. */
  getPull(workspaceId: string, prId: string): Promise<BlastPull | undefined>;

  /** Changed file paths for the PR (repo-root relative, as tracked in git). */
  getPrFiles(prId: string): Promise<string[]>;

  /**
   * Other PRs (same workspace + repo, excluding `excludePrId`) whose
   * `pr_files.path` overlaps any of `paths`, newest-`number`-first. Returns
   * `[]` (never throws) when `paths` is empty or nothing overlaps.
   */
  getPriorPrsForFiles(
    workspaceId: string,
    repoId: string,
    excludePrId: string,
    paths: string[],
    limit: number,
  ): Promise<PriorPrRow[]>;
}
