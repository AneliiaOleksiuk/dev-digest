import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAgentOnPrHandler } from '../src/tools/run-agent-on-pr.js';
import { VerdictResultSchema } from '../src/schemas.js';
import { createFakeApi } from './fake-api.js';
import { makeAgent, makePrMeta, makeRepo, makeReview, makeReviewRunResponse, makeRunSummary } from './fixtures.js';

function makeExtra(): RequestHandlerExtra<ServerRequest, ServerNotification> {
  return {
    signal: new AbortController().signal,
    requestId: 1,
    sendNotification: vi.fn(async () => {}),
    sendRequest: async () => {
      throw new Error('sendRequest not supported in tests');
    },
  };
}

describe('run_agent_on_pr', () => {
  afterEach(() => {
    delete process.env.DEVDIGEST_MCP_RUN_TIMEOUT_MS;
    vi.useRealTimers();
  });

  it('happy path: resolves repo→pr→agent, posts a review, polls to done, returns the verdict', async () => {
    vi.useFakeTimers();
    const repo = makeRepo();
    const pr = makePrMeta();
    const agent = makeAgent();
    const review = makeReview();
    let runsPollCount = 0;

    const api = createFakeApi({
      get: (path) => {
        if (path === '/repos') return [repo];
        if (path === `/repos/${repo.id}/pulls`) return [pr];
        if (path === '/agents') return [agent];
        if (path === `/pulls/${pr.id}/runs`) {
          runsPollCount += 1;
          return [makeRunSummary({ status: runsPollCount === 1 ? 'running' : 'done' })];
        }
        if (path === `/pulls/${pr.id}/reviews`) return [review];
        throw new Error(`unexpected GET ${path}`);
      },
      post: (path) => {
        if (path === `/pulls/${pr.id}/review`) return makeReviewRunResponse();
        throw new Error(`unexpected POST ${path}`);
      },
    });

    const resultPromise = runAgentOnPrHandler(
      api,
      { repo: repo.full_name, pr: pr.number, agent: agent.id },
      makeExtra(),
    );
    await vi.advanceTimersByTimeAsync(5000);
    const result = await resultPromise;

    expect(result.isError).toBeUndefined();
    const structured = VerdictResultSchema.parse(result.structuredContent);
    expect(structured.run_id).toBe('run-1');
    expect(structured.verdict).toBe('comment');
    expect(runsPollCount).toBeGreaterThanOrEqual(2);
  });

  it('unknown agent → isError:true, message points at list_agents, no run is started', async () => {
    const repo = makeRepo();
    const pr = makePrMeta();
    let postCalled = false;

    const api = createFakeApi({
      get: (path) => {
        if (path === '/repos') return [repo];
        if (path === `/repos/${repo.id}/pulls`) return [pr];
        if (path === '/agents') return [makeAgent()];
        throw new Error(`unexpected GET ${path}`);
      },
      post: () => {
        postCalled = true;
        throw new Error('should not start a review run for an unresolved agent');
      },
    });

    const result = await runAgentOnPrHandler(
      api,
      { repo: repo.full_name, pr: pr.number, agent: 'does-not-exist' },
      makeExtra(),
    );

    expect(result.isError).toBe(true);
    const [block] = result.content ?? [];
    expect((block as { text: string }).text).toContain('list_agents');
    expect(postCalled).toBe(false);
  });

  it('poll timeout → isError:true, message points at get_findings, no exception escapes', async () => {
    process.env.DEVDIGEST_MCP_RUN_TIMEOUT_MS = '3000';
    vi.useFakeTimers();
    const repo = makeRepo();
    const pr = makePrMeta();
    const agent = makeAgent();

    const api = createFakeApi({
      get: (path) => {
        if (path === '/repos') return [repo];
        if (path === `/repos/${repo.id}/pulls`) return [pr];
        if (path === '/agents') return [agent];
        if (path === `/pulls/${pr.id}/runs`) return [makeRunSummary({ status: 'running' })];
        throw new Error(`unexpected GET ${path}`);
      },
      post: (path) => {
        if (path === `/pulls/${pr.id}/review`) return makeReviewRunResponse();
        throw new Error(`unexpected POST ${path}`);
      },
    });

    const resultPromise = runAgentOnPrHandler(
      api,
      { repo: repo.full_name, pr: pr.number, agent: agent.id },
      makeExtra(),
    );
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await resultPromise;

    expect(result.isError).toBe(true);
    const [block] = result.content ?? [];
    expect((block as { text: string }).text).toContain('get_findings');
  });
});
