/**
 * Smart Diff data-access port. Reads `pr_files` + latest-review findings.
 * Interface + plain types only — no Drizzle imports.
 */

export interface SmartDiffPrFile {
  path: string;
  additions: number;
  deletions: number;
}

export interface SmartDiffFindingLine {
  file: string;
  start_line: number;
  end_line: number;
}

export interface SmartDiffRepository {
  /** Workspace-scoped existence check (drives the 404). */
  getPull(workspaceId: string, prId: string): Promise<{ id: string } | undefined>;

  /** Changed files for the PR (path + line counts only — no patch). */
  getPrFiles(prId: string): Promise<SmartDiffPrFile[]>;

  /**
   * Findings of the single most-recently-created reviews row for the PR.
   * Empty when the PR has no review yet.
   */
  latestReviewFindings(prId: string): Promise<SmartDiffFindingLine[]>;
}
