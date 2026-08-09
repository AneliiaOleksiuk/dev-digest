import type { SmartDiffResponse } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { buildSplitSuggestion, groupFiles } from './helpers.js';
import type { SmartDiffRepository } from './repository.js';

export class SmartDiffService {
  constructor(private repo: SmartDiffRepository) {}

  async getSmartDiff(workspaceId: string, prId: string): Promise<SmartDiffResponse> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const [files, findings] = await Promise.all([
      this.repo.getPrFiles(prId),
      this.repo.latestReviewFindings(prId),
    ]);

    // pr_files is only populated once GET /pulls/:id has run — never call GitHub here.
    if (files.length === 0) {
      return {
        groups: [],
        split_suggestion: { too_big: false, total_lines: 0, proposed_splits: [] },
      };
    }

    const groups = groupFiles(files, findings);
    const total_lines = files.reduce((sum, f) => sum + f.additions + f.deletions, 0);
    const split_suggestion = buildSplitSuggestion(groups, total_lines);

    return { groups, split_suggestion };
  }
}
