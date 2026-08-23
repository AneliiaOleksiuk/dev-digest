import type { Skill, SkillSource, SkillType, SkillVersion } from '@devdigest/shared';
import type { SkillsRepository } from './repository.js';
import { toSkillDto, toSkillVersionDto, deriveNameFromBody } from './helpers.js';
import type { SkillUrlFetcher } from './url-fetcher.js';
import type { ContextRepository } from '../project-context/repository.js';

export interface CreateSkillInput {
  name: string;
  description: string;
  type: SkillType;
  source: SkillSource;
  body: string;
  enabled?: boolean;
  evidence_files?: string[];
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
  evidence_files?: string[];
}

export class SkillsService {
  constructor(
    private repo: SkillsRepository,
    private urlFetcher: SkillUrlFetcher,
    private contextRepo: ContextRepository,
  ) {}

  async list(workspaceId: string): Promise<Skill[]> {
    const rows = await this.repo.list(workspaceId);
    return rows.map(toSkillDto);
  }

  async get(workspaceId: string, id: string): Promise<Skill | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toSkillDto(row) : undefined;
  }

  async create(workspaceId: string, input: CreateSkillInput): Promise<Skill> {
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description,
      type: input.type,
      source: input.source,
      body: input.body,
      enabled: input.enabled,
      evidenceFiles: input.evidence_files,
    });
    return toSkillDto(row);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkillInput,
  ): Promise<Skill | undefined> {
    const row = await this.repo.update(workspaceId, id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.type !== undefined ? { type: patch.type } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.evidence_files !== undefined ? { evidenceFiles: patch.evidence_files } : {}),
    });
    return row ? toSkillDto(row) : undefined;
  }

  /** Also explicitly deletes this skill's project-context attachment rows —
   *  `surfaceId` there carries no FK (R-D, docs/plans/spec-01-project-context.md). */
  async delete(workspaceId: string, id: string): Promise<boolean> {
    const ok = await this.repo.deleteById(workspaceId, id);
    if (ok) await this.contextRepo.deleteForSurface(workspaceId, 'skill', id);
    return ok;
  }

  /** Import a skill from pasted/uploaded markdown. Trusted enough to enable
   *  immediately — the user directly supplied the content. */
  async importFile(
    workspaceId: string,
    input: { name?: string; body: string },
  ): Promise<Skill> {
    const name = input.name?.trim() || deriveNameFromBody(input.body) || 'Untitled skill';
    const row = await this.repo.insert({
      workspaceId,
      name,
      description: '',
      type: 'custom',
      source: 'extracted',
      body: input.body,
      enabled: true,
    });
    return toSkillDto(row);
  }

  /** Import a skill from an external URL (server-side fetch). Lands disabled
   *  — someone else's content needs vetting before it's live in a prompt. */
  async importUrl(workspaceId: string, url: string): Promise<Skill> {
    const body = await this.urlFetcher.fetchText(url);
    const name = deriveNameFromBody(body) || url;
    const row = await this.repo.insert({
      workspaceId,
      name,
      description: '',
      type: 'custom',
      source: 'imported_url',
      body,
      enabled: false,
    });
    return toSkillDto(row);
  }

  async listVersions(workspaceId: string, skillId: string): Promise<SkillVersion[] | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    const rows = await this.repo.listVersions(skillId);
    return rows.map(toSkillVersionDto);
  }

  async getVersion(
    workspaceId: string,
    skillId: string,
    version: number,
  ): Promise<SkillVersion | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    const row = await this.repo.getVersion(skillId, version);
    return row ? toSkillVersionDto(row) : undefined;
  }
}
