/**
 * `BriefSources` adapter — the module's ONLY file that touches the
 * filesystem, git, or another module's service directly. Precedent for an
 * fs-touching non-`service.ts` module file that already passes `arch:check`:
 * `modules/onboarding/facts.ts`.
 */
import { readFile } from 'node:fs/promises';
import type { BlastRadiusResponse, UnifiedDiff } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { ReviewRepository } from '../reviews/repository.js';
import { loadDiff as loadDiffImpl } from '../reviews/diff-loader.js';
import { isInsideClone } from '../reviews/intent-inputs.js';
import { BlastService } from '../blast/service.js';
import { MAX_SPEC_FILE_READ_CHARS } from './constants.js';
import type { BriefPull, BriefRepoRow } from './repository.js';
import type { BriefSources } from './sources.js';

export class NodeBriefSources implements BriefSources {
  constructor(private container: Container) {}

  async loadDiff(workspaceId: string, pull: BriefPull, repoRow: BriefRepoRow): Promise<UnifiedDiff> {
    // Re-resolve the full PullRow/repos row `reviews/diff-loader.ts` expects
    // — its signature needs fields (`workspaceId`, `number`, `author`, …)
    // beyond this module's own narrower `BriefPull`/`BriefRepoRow` shapes.
    // A fresh, indexed lookup here is cheap relative to the LLM call this
    // generation is about to make.
    const reviewRepo = new ReviewRepository(this.container.db);
    const [fullPull, fullRepo] = await Promise.all([
      reviewRepo.getPull(workspaceId, pull.id),
      reviewRepo.getRepo(repoRow.id),
    ]);
    if (!fullPull || !fullRepo) return { raw: '', files: [] };
    return loadDiffImpl(this.container, reviewRepo, workspaceId, fullPull, fullRepo);
  }

  async readSpecFile(clonePath: string, ref: string): Promise<string | null> {
    const abs = isInsideClone(clonePath, ref);
    if (!abs) return null;
    const content = await readFile(abs, 'utf8').catch(() => null);
    if (content == null) return null;
    return content.slice(0, MAX_SPEC_FILE_READ_CHARS);
  }

  async getBlastSummary(workspaceId: string, prId: string): Promise<BlastRadiusResponse> {
    const blastService = new BlastService(this.container.blastRepo, this.container);
    return blastService.getBlastRadius(workspaceId, prId);
  }

  async fetchLinkedIssue(repoRow: BriefRepoRow, issueNumber: number): Promise<string | null> {
    try {
      const github = await this.container.github();
      const issue = await github.getIssue({ owner: repoRow.owner, name: repoRow.name }, issueNumber);
      return `${issue.title}\n${issue.body ?? ''}`;
    } catch {
      return null;
    }
  }
}
