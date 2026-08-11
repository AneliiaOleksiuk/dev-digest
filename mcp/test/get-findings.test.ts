import { describe, expect, it } from 'vitest';
import { getFindingsHandler } from '../src/tools/get-findings.js';
import { VerdictResultSchema } from '../src/schemas.js';
import { createFakeApi } from './fake-api.js';
import { makeAgent, makePrMeta, makeRepo, makeReview } from './fixtures.js';

describe('get_findings', () => {
  it('returns the latest completed review projected to VerdictResult', async () => {
    const repo = makeRepo();
    const pr = makePrMeta();
    const review = makeReview();

    const api = createFakeApi({
      get: (path) => {
        if (path === '/repos') return [repo];
        if (path === `/repos/${repo.id}/pulls`) return [pr];
        if (path === `/pulls/${pr.id}/reviews`) return [review];
        throw new Error(`unexpected GET ${path}`);
      },
    });

    const result = await getFindingsHandler(api, { repo: repo.full_name, pr: pr.number });

    expect(result.isError).toBeUndefined();
    const structured = VerdictResultSchema.parse(result.structuredContent);
    expect(structured.verdict).toBe('comment');
    expect(structured.run_id).toBe('run-1');
    expect(structured.findings).toHaveLength(1);
    expect(structured.findings[0]).not.toHaveProperty('confidence');
    expect(structured.findings[0]).not.toHaveProperty('id');
  });

  it('errors pointing at run_agent_on_pr when no completed review exists', async () => {
    const repo = makeRepo();
    const pr = makePrMeta();

    const api = createFakeApi({
      get: (path) => {
        if (path === '/repos') return [repo];
        if (path === `/repos/${repo.id}/pulls`) return [pr];
        if (path === `/pulls/${pr.id}/reviews`) return [];
        throw new Error(`unexpected GET ${path}`);
      },
    });

    const result = await getFindingsHandler(api, { repo: repo.full_name, pr: pr.number });

    expect(result.isError).toBe(true);
    const text = result.content?.[0];
    expect(text?.type).toBe('text');
    expect((text as { text: string }).text).toContain('run_agent_on_pr');
  });

  it('matches a review by agent_name when agent_id is null', async () => {
    const repo = makeRepo();
    const pr = makePrMeta();
    const agent = makeAgent();
    const otherReview = makeReview({ id: 'review-2', agent_id: 'agent-2', agent_name: 'Other Agent' });
    const nameOnlyReview = makeReview({ agent_id: null, agent_name: agent.name });

    const api = createFakeApi({
      get: (path) => {
        if (path === '/repos') return [repo];
        if (path === `/repos/${repo.id}/pulls`) return [pr];
        if (path === '/agents') return [agent];
        if (path === `/pulls/${pr.id}/reviews`) return [otherReview, nameOnlyReview];
        throw new Error(`unexpected GET ${path}`);
      },
    });

    const result = await getFindingsHandler(api, { repo: repo.full_name, pr: pr.number, agent: agent.id });

    expect(result.isError).toBeUndefined();
    const structured = VerdictResultSchema.parse(result.structuredContent);
    expect(structured.run_id).toBe(nameOnlyReview.run_id);
  });
});
