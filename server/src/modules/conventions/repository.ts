import type { ConventionRow } from '../../db/rows.js';
export type { ConventionRow };

export interface InsertConvention {
  workspaceId: string;
  repoId: string;
  category?: string | null;
  rule: string;
  evidencePath: string;
  evidenceSnippet: string;
  evidenceLine?: number | null;
  confidence: number;
}

export interface UpdateConvention {
  status?: 'pending' | 'accepted' | 'rejected';
  rule?: string;
  evidencePath?: string;
  evidenceSnippet?: string;
  skillId?: string | null;
}

/** Conventions data-access port. Workspace-scoped throughout. */
export interface ConventionsRepository {
  listByRepo(workspaceId: string, repoId: string): Promise<ConventionRow[]>;
  getById(workspaceId: string, id: string): Promise<ConventionRow | undefined>;
  insertMany(values: InsertConvention[]): Promise<ConventionRow[]>;
  update(
    workspaceId: string,
    id: string,
    patch: UpdateConvention,
  ): Promise<ConventionRow | undefined>;
  /** Drop candidates from a previous scan that were never promoted to a skill. */
  deleteUnpromoted(workspaceId: string, repoId: string): Promise<void>;
}
