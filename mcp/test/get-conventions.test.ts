import { describe, expect, it } from 'vitest';
import { getConventionsHandler } from '../src/tools/get-conventions.js';
import { GetConventionsOutputSchema } from '../src/schemas.js';
import { createFakeApi } from './fake-api.js';
import { makeConvention, makeRepo } from './fixtures.js';

describe('get_conventions', () => {
  it('maps ConventionCandidate[] to ConventionSummary[]', async () => {
    const repo = makeRepo();
    const convention = makeConvention();

    const api = createFakeApi({
      get: (path) => {
        if (path === '/repos') return [repo];
        if (path === `/repos/${repo.id}/conventions`) return [convention];
        throw new Error(`unexpected GET ${path}`);
      },
    });

    const result = await getConventionsHandler(api, { repo: repo.full_name });

    expect(result.isError).toBeUndefined();
    const structured = GetConventionsOutputSchema.parse(result.structuredContent);
    expect(structured.conventions).toEqual([
      {
        category: 'style',
        rule: convention.rule,
        evidence: `${convention.evidence_path}:${convention.evidence_line}`,
        status: 'accepted',
      },
    ]);
    expect(structured.note).toBeUndefined();
  });

  it('returns an empty-list note when the repo has no conventions', async () => {
    const repo = makeRepo();

    const api = createFakeApi({
      get: (path) => {
        if (path === '/repos') return [repo];
        if (path === `/repos/${repo.id}/conventions`) return [];
        throw new Error(`unexpected GET ${path}`);
      },
    });

    const result = await getConventionsHandler(api, { repo: repo.full_name });

    expect(result.isError).toBeUndefined();
    const structured = GetConventionsOutputSchema.parse(result.structuredContent);
    expect(structured.conventions).toEqual([]);
    expect(structured.note).toBeTruthy();
  });
});
