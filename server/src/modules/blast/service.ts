import type { BlastRadiusResponse } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { MAX_PATHS_FOR_PRIOR_PRS, MAX_PRIOR_PRS } from './constants.js';
import { buildSummary, deriveStatus, mapBlastResult, mapPriorPrs } from './helpers.js';
import type { BlastRepository } from './repository.js';

export class BlastService {
  constructor(
    private repo: BlastRepository,
    private container: Container,
  ) {}

  async getBlastRadius(workspaceId: string, prId: string): Promise<BlastRadiusResponse> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const files = await this.repo.getPrFiles(prId);

    // pr_files is only populated once GET /pulls/:id has run (see
    // smart-diff/service.ts) — an empty list here means "not synced yet",
    // never "no impact". Never present this as a confident 200-with-nothing.
    if (files.length === 0) {
      return {
        changed_symbols: [],
        downstream: [],
        summary: "Blast radius is unavailable — this PR's changed files have not been synced yet.",
        status: 'degraded',
        reason:
          'No changed files are recorded for this PR yet. Open the PR detail page once (GET /pulls/:id) to sync them, then reload this tab.',
        // No file paths to overlap on this path — an empty list here is
        // honest, not a silent failure (WI5).
        prior_prs: [],
      };
    }

    // The two repo-intel facade calls this module makes, plus the prior-PRs
    // overlap read (WI5) — one extra round trip, run in parallel, not
    // serially. `summary` stays about the impact map only; prior PRs are
    // provenance, deliberately not folded into it.
    const [blast, indexState, priorPrRows] = await Promise.all([
      this.container.repoIntel.getBlastRadius(pull.repoId, files),
      this.container.repoIntel.getIndexState(pull.repoId),
      this.repo.getPriorPrsForFiles(
        workspaceId,
        pull.repoId,
        prId,
        files.slice(0, MAX_PATHS_FOR_PRIOR_PRS),
        MAX_PRIOR_PRS,
      ),
    ]);

    const { changed_symbols, downstream } = mapBlastResult(blast);
    const { status, reason } = deriveStatus(indexState, blast);
    const summary = buildSummary(changed_symbols.length, downstream, status);
    const prior_prs = mapPriorPrs(priorPrRows);

    return { changed_symbols, downstream, summary, status, reason, prior_prs };
  }
}
