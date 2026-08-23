import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { ChatMessage, ConventionCandidate, Skill } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { RepoRepository } from '../repos/repository.js';
import { SkillsService } from '../skills/service.js';
import { toConventionDto } from './helpers.js';
import type { ConventionsRepository, InsertConvention } from './repository.js';
import { CONFIG_FILES, MAX_FILE_CHARS, SAMPLE_SIZE } from './constants.js';

interface SampledFile {
  path: string;
  content: string;
}

const LlmCandidate = z.object({
  category: z.string(),
  rule: z.string(),
  evidence_file: z.string(),
  /** Exact line of code copied verbatim from the sample — never a paraphrase.
   *  The real line number is found by searching for this text, never trusted
   *  from the model's own counting (cheap models routinely miscount / default
   *  to line 1). */
  evidence_snippet: z.string().min(1),
  confidence: z.number().min(0).max(1),
});
const LlmCandidateList = z.object({ candidates: z.array(LlmCandidate) });

export interface UpdateConventionInput {
  status?: 'pending' | 'accepted' | 'rejected';
  rule?: string;
  evidence_path?: string;
  evidence_snippet?: string;
}

export interface PromoteInput {
  conventionIds: string[];
  skill: {
    name: string;
    description: string;
    body: string;
    enabled?: boolean;
  };
}

export class ConventionsService {
  private repos: RepoRepository;

  constructor(
    private repo: ConventionsRepository,
    private container: Container,
  ) {
    this.repos = new RepoRepository(container.db);
  }

  async list(workspaceId: string, repoId: string): Promise<ConventionCandidate[]> {
    const rows = await this.repo.listByRepo(workspaceId, repoId);
    return rows.map(toConventionDto);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateConventionInput,
  ): Promise<ConventionCandidate | undefined> {
    const row = await this.repo.update(workspaceId, id, {
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.rule !== undefined ? { rule: patch.rule } : {}),
      ...(patch.evidence_path !== undefined ? { evidencePath: patch.evidence_path } : {}),
      ...(patch.evidence_snippet !== undefined ? { evidenceSnippet: patch.evidence_snippet } : {}),
    });
    return row ? toConventionDto(row) : undefined;
  }

  /** Bundle accepted candidates into one real skill, then link them to it. */
  async promote(workspaceId: string, input: PromoteInput): Promise<Skill> {
    const skillsService = new SkillsService(
      this.container.skillsRepo,
      this.container.skillUrlFetcher,
      this.container.contextRepo,
    );
    const skill = await skillsService.create(workspaceId, {
      name: input.skill.name,
      description: input.skill.description,
      type: 'convention',
      source: 'extracted',
      body: input.skill.body,
      enabled: input.skill.enabled,
    });
    await Promise.all(
      input.conventionIds.map((id) =>
        this.repo.update(workspaceId, id, { status: 'accepted', skillId: skill.id }),
      ),
    );
    return skill;
  }

  /**
   * Sample repo files, ask the LLM for convention candidates, drop any whose
   * evidence doesn't check out against the actual sampled content, persist
   * the survivors. Degrades to `[]` when the repo has no local clone yet.
   */
  async extract(workspaceId: string, repoId: string): Promise<ConventionCandidate[]> {
    const repoRow = await this.repos.getById(workspaceId, repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');
    if (!repoRow.clonePath) return [];

    const rankedPaths = await this.container.repoIntel.getConventionSamples(repoId, SAMPLE_SIZE);
    const sample = [
      ...(await this.readFiles(repoRow.clonePath, CONFIG_FILES)),
      ...(await this.readFiles(repoRow.clonePath, rankedPaths)),
    ];
    if (sample.length === 0) return [];

    const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'conventions');
    const llm = await this.container.llm(provider);
    const result = await llm.completeStructured({
      model,
      schema: LlmCandidateList,
      schemaName: 'ConventionExtraction',
      messages: this.buildMessages(sample),
    });

    const grounded = this.groundCandidates(result.data.candidates, sample, workspaceId, repoId);

    await this.repo.deleteUnpromoted(workspaceId, repoId);
    const inserted = await this.repo.insertMany(grounded);
    return inserted.map(toConventionDto);
  }

  /**
   * Discard any LLM candidate whose quoted evidence doesn't actually appear,
   * verbatim, in the sampled file — the real line number is wherever that
   * quoted text is genuinely found, never the model's own claimed number.
   */
  private groundCandidates(
    candidates: z.infer<typeof LlmCandidate>[],
    sample: SampledFile[],
    workspaceId: string,
    repoId: string,
  ): InsertConvention[] {
    return candidates.flatMap((candidate) => {
      const matchingFile = sample.find((sampledFile) => sampledFile.path === candidate.evidence_file);
      if (!matchingFile) return [];

      const quotedText = candidate.evidence_snippet.trim();
      const lines = matchingFile.content.split('\n');
      const matchingLineIndex = lines.findIndex((line) => line.includes(quotedText));
      if (matchingLineIndex === -1) return [];

      return [
        {
          workspaceId,
          repoId,
          category: candidate.category,
          rule: candidate.rule,
          evidencePath: candidate.evidence_file,
          evidenceSnippet: lines[matchingLineIndex]!.trim(),
          evidenceLine: matchingLineIndex + 1,
          confidence: candidate.confidence,
        },
      ];
    });
  }

  private buildMessages(sample: SampledFile[]): ChatMessage[] {
    const filesBlock = sample.map((file) => `--- ${file.path} ---\n${file.content}`).join('\n\n');
    return [
      {
        role: 'system',
        content:
          'You analyze a codebase sample and extract concrete, project-specific coding conventions ' +
          '(naming, structure, error handling, async style, etc). For evidence_snippet, copy one line ' +
          'of code EXACTLY as it appears in the sample — verbatim, no paraphrasing, no line-number ' +
          'prefix — so it can be found by an exact text search. Only report a rule if the quoted line ' +
          'genuinely demonstrates it. Skip generic advice that is not actually followed in this sample.',
      },
      { role: 'user', content: `Repository file sample:\n\n${filesBlock}` },
    ];
  }

  private async readFiles(clonePath: string, paths: string[]): Promise<SampledFile[]> {
    const results = await Promise.all(
      paths.map(async (path) => {
        const content = await readFile(join(clonePath, path), 'utf8').catch(() => null);
        return content ? { path, content: content.slice(0, MAX_FILE_CHARS) } : null;
      }),
    );
    return results.filter((file): file is SampledFile => file !== null);
  }
}
