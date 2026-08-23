import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReviewInput, ReviewOutcome } from '@devdigest/reviewer-core';

/**
 * WI7 (Phase C) — implementer's own manual verification that AC-18/D-2 holds:
 * the `ReviewInput` the batch runner assembles for `reviewPullRequest` never
 * carries `callers`, `repoMap`, `specs`, or `intent` — an eval run must never
 * lean on repo-intel/project-context enrichment a case didn't pin at creation
 * time. `test-writer` owns the FULL AC-14…AC-22 table for `runner.ts`/
 * `service.ts`; this file is deliberately narrow — the one assertion the plan
 * (docs/plans/eval-pipeline.md, WI7) explicitly asked the implementer to
 * verify by running code, not just by reading it.
 */

const reviewPullRequestMock = vi.fn<(input: ReviewInput) => Promise<ReviewOutcome>>();

vi.mock('@devdigest/reviewer-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@devdigest/reviewer-core')>();
  return { ...actual, reviewPullRequest: reviewPullRequestMock };
});

// Imported AFTER the mock so `runner.ts` picks up the mocked `reviewPullRequest`.
const { runOneCase } = await import('../src/modules/eval/runner.js');
const { MockLLMProvider } = await import('../src/adapters/mocks.js');

function mockOutcome(overrides: Partial<ReviewOutcome> = {}): ReviewOutcome {
  return {
    review: { verdict: 'comment', summary: 'ok', score: 90, findings: [] },
    grounding: '0/0 passed',
    dropped: [],
    mode: 'single-pass',
    assembly: { system: 'sys', skills: null, memory: null, specs: null, user: 'diff' },
    sections: [],
    chunks: [{ label: 'all files' }],
    tokensIn: 100,
    tokensOut: 50,
    costUsd: 0.001,
    raw: '{}',
    ...overrides,
  };
}

const SAMPLE_DIFF =
  'diff --git a/src/x.ts b/src/x.ts\n--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1,1 +1,1 @@\n-old\n+new';

describe('runOneCase — AC-18/D-2: the assembled ReviewInput carries NONE of callers/repoMap/specs/intent', () => {
  beforeEach(() => {
    reviewPullRequestMock.mockReset();
    reviewPullRequestMock.mockResolvedValue(mockOutcome());
  });

  it('reviewPullRequest is called with an input object that has no callers/repoMap/specs/intent key', async () => {
    const llm = new MockLLMProvider('openai');
    await runOneCase(
      { systemPrompt: 'You are a reviewer', model: 'gpt-4.1', strategy: 'single-pass', skills: [], llm },
      { id: 'case-1', inputDiff: SAMPLE_DIFF, inputMeta: { title: 'PR title', body: 'PR body' }, expectation: null },
    );

    expect(reviewPullRequestMock).toHaveBeenCalledTimes(1);
    const input = reviewPullRequestMock.mock.calls[0]![0];

    expect(input).not.toHaveProperty('callers');
    expect(input).not.toHaveProperty('repoMap');
    expect(input).not.toHaveProperty('specs');
    expect(input).not.toHaveProperty('intent');

    // The keys WI7 DOES specify are present.
    expect(input.systemPrompt).toBe('You are a reviewer');
    expect(input.model).toBe('gpt-4.1');
    expect(input.strategy).toBe('single-pass');
    expect(input.prDescription).toBe('PR body');
    expect(input.diff.files.map((f) => f.path)).toEqual(['src/x.ts']);
  });

  it('omits the `skills` key entirely when the pinned snapshot has no enabled skills (omit-when-empty, matching run-executor.ts)', async () => {
    const llm = new MockLLMProvider('openai');
    await runOneCase(
      { systemPrompt: 'sys', model: 'gpt-4.1', strategy: 'single-pass', skills: [], llm },
      { id: 'case-1', inputDiff: SAMPLE_DIFF, inputMeta: null, expectation: null },
    );
    const input = reviewPullRequestMock.mock.calls[0]![0];
    expect(input).not.toHaveProperty('skills');
  });

  it('includes `skills` (resolved bodies, not slugs) when the pinned snapshot has enabled skills', async () => {
    const llm = new MockLLMProvider('openai');
    await runOneCase(
      { systemPrompt: 'sys', model: 'gpt-4.1', strategy: 'single-pass', skills: ['### Rule 1\nbody'], llm },
      { id: 'case-1', inputDiff: SAMPLE_DIFF, inputMeta: null, expectation: null },
    );
    const input = reviewPullRequestMock.mock.calls[0]![0];
    expect(input.skills).toEqual(['### Rule 1\nbody']);
  });
});
