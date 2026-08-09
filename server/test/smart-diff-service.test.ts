/**
 * SmartDiffService with an in-memory fake repository (no DB / Docker).
 */
import { describe, it, expect } from 'vitest';
import { SmartDiffResponse } from '@devdigest/shared';
import { NotFoundError } from '../src/platform/errors.js';
import { SmartDiffService } from '../src/modules/smart-diff/service.js';
import type {
  SmartDiffFindingLine,
  SmartDiffPrFile,
  SmartDiffRepository,
} from '../src/modules/smart-diff/repository.js';

class FakeRepo implements SmartDiffRepository {
  constructor(
    private pull: { id: string } | undefined,
    private files: SmartDiffPrFile[],
    private findings: SmartDiffFindingLine[],
  ) {}

  async getPull(_workspaceId: string, prId: string) {
    return this.pull?.id === prId ? this.pull : undefined;
  }
  async getPrFiles() {
    return this.files;
  }
  async latestReviewFindings() {
    return this.findings;
  }
}

describe('SmartDiffService', () => {
  it('throws NotFoundError when the PR is missing', async () => {
    const svc = new SmartDiffService(new FakeRepo(undefined, [], []));
    await expect(svc.getSmartDiff('ws', 'missing')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('returns the empty shape when pr_files is empty', async () => {
    const svc = new SmartDiffService(new FakeRepo({ id: 'pr-1' }, [], []));
    const result = await svc.getSmartDiff('ws', 'pr-1');
    expect(result).toEqual({
      groups: [],
      split_suggestion: { too_big: false, total_lines: 0, proposed_splits: [] },
    });
    expect(() => SmartDiffResponse.parse(result)).not.toThrow();
  });

  it('groups files and attaches finding_lines from the latest review', async () => {
    const svc = new SmartDiffService(
      new FakeRepo(
        { id: 'pr-1' },
        [
          { path: 'src/middleware/ratelimit.ts', additions: 84, deletions: 8 },
          { path: 'src/server.ts', additions: 5, deletions: 1 },
          { path: 'package-lock.json', additions: 20, deletions: 2 },
        ],
        [
          { file: 'src/middleware/ratelimit.ts', start_line: 28, end_line: 52 },
          { file: 'src/middleware/ratelimit.ts', start_line: 40, end_line: 40 },
        ],
      ),
    );
    const result = await svc.getSmartDiff('ws', 'pr-1');
    expect(() => SmartDiffResponse.parse(result)).not.toThrow();
    expect(result.groups.map((g) => g.role)).toEqual(['core', 'wiring', 'boilerplate']);
    const core = result.groups.find((g) => g.role === 'core')!;
    expect(core.files[0]!.finding_lines).toEqual([28, 40]);
    expect(core.files[0]!.pseudocode_summary).toBeNull();
    expect(result.split_suggestion.total_lines).toBe(84 + 8 + 5 + 1 + 20 + 2);
  });
});
