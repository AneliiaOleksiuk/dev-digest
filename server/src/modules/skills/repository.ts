import type { SkillSource, SkillType } from '@devdigest/shared';
import type { SkillRow, SkillVersionRow } from '../../db/rows.js';
export type { SkillRow, SkillVersionRow };

/**
 * Skills data-access port. Owns `skills` and `skill_versions`. Workspace-scoped
 * throughout — the agent-side `agent_skills` link table is owned by
 * `modules/agents/repository.ts` (A2), not here.
 */

export interface InsertSkill {
  workspaceId: string;
  name: string;
  description: string;
  type: SkillType;
  source: SkillSource;
  body: string;
  enabled?: boolean;
  evidenceFiles?: string[];
}

export interface UpdateSkill {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
  evidenceFiles?: string[];
}

export interface SkillsRepository {
  list(workspaceId: string): Promise<SkillRow[]>;
  getById(workspaceId: string, id: string): Promise<SkillRow | undefined>;
  insert(values: InsertSkill): Promise<SkillRow>;
  update(workspaceId: string, id: string, patch: UpdateSkill): Promise<SkillRow | undefined>;
  deleteById(workspaceId: string, id: string): Promise<boolean>;
  listVersions(skillId: string): Promise<SkillVersionRow[]>;
  getVersion(skillId: string, version: number): Promise<SkillVersionRow | undefined>;
}
