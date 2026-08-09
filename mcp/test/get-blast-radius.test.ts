import { describe, expect, it } from 'vitest';
import { getBlastRadiusHandler } from '../src/tools/get-blast-radius.js';
import { GetBlastRadiusOutputSchema, MAX_BLAST_CALLERS_PER_SYMBOL, MAX_BLAST_SYMBOLS } from '../src/schemas.js';
import { createFakeApi } from './fake-api.js';
import { makeBlastRadiusResponse, makePrMeta, makeRepo } from './fixtures.js';

describe('get_blast_radius', () => {
  it('maps a full BlastRadiusResponse to the compact output DTO', async () => {
    const repo = makeRepo();
    const pr = makePrMeta();
    const blast = makeBlastRadiusResponse();

    const api = createFakeApi({
      get: (path) => {
        if (path === '/repos') return [repo];
        if (path === `/repos/${repo.id}/pulls`) return [pr];
        if (path === `/pulls/${pr.id}/blast`) return blast;
        throw new Error(`unexpected GET ${path}`);
      },
    });

    const result = await getBlastRadiusHandler(api, { repo: repo.full_name, pr: pr.number });

    expect(result.isError).toBeUndefined();
    const structured = GetBlastRadiusOutputSchema.parse(result.structuredContent);
    expect(structured.status).toBe('full');
    expect(structured.reason).toBeNull();
    expect(structured.changed_symbols).toEqual(blast.changed_symbols);
    expect(structured.downstream).toEqual([
      {
        symbol: 'chargeCard',
        callers: [{ name: 'handleWebhook', file: 'src/billing/webhook.ts', line: 42 }],
        endpoints_affected: ['POST /webhooks/stripe'],
        crons_affected: [],
      },
    ]);
    expect(structured.omitted_symbols).toBeUndefined();
    expect(result.content?.[0]).toEqual({ type: 'text', text: blast.summary });
  });

  it('surfaces a degraded status and its reason (never silently dropped)', async () => {
    const repo = makeRepo();
    const pr = makePrMeta();
    const blast = makeBlastRadiusResponse({
      changed_symbols: [],
      downstream: [],
      status: 'degraded',
      reason: 'This repo has no usable code index yet.',
      summary: 'Blast radius is unavailable.',
    });

    const api = createFakeApi({
      get: (path) => {
        if (path === '/repos') return [repo];
        if (path === `/repos/${repo.id}/pulls`) return [pr];
        if (path === `/pulls/${pr.id}/blast`) return blast;
        throw new Error(`unexpected GET ${path}`);
      },
    });

    const result = await getBlastRadiusHandler(api, { repo: repo.full_name, pr: pr.number });

    expect(result.isError).toBeUndefined();
    const structured = GetBlastRadiusOutputSchema.parse(result.structuredContent);
    expect(structured.status).toBe('degraded');
    expect(structured.reason).toBe('This repo has no usable code index yet.');
    expect(structured.changed_symbols).toEqual([]);
  });

  it('caps changed_symbols/callers and adds omitted_* counters when over budget', async () => {
    const repo = makeRepo();
    const pr = makePrMeta();
    const manySymbols = Array.from({ length: MAX_BLAST_SYMBOLS + 5 }, (_, i) => ({
      name: `symbol${i}`,
      file: `src/file${i}.ts`,
      kind: 'function',
    }));
    const manyCallers = Array.from({ length: MAX_BLAST_CALLERS_PER_SYMBOL + 3 }, (_, i) => ({
      name: `caller${i}`,
      file: `src/caller${i}.ts`,
      line: i + 1,
    }));
    const blast = makeBlastRadiusResponse({
      changed_symbols: manySymbols,
      downstream: manySymbols.map((symbol, i) => ({
        symbol: symbol.name,
        callers: i === 0 ? manyCallers : [],
        endpoints_affected: [],
        crons_affected: [],
      })),
    });

    const api = createFakeApi({
      get: (path) => {
        if (path === '/repos') return [repo];
        if (path === `/repos/${repo.id}/pulls`) return [pr];
        if (path === `/pulls/${pr.id}/blast`) return blast;
        throw new Error(`unexpected GET ${path}`);
      },
    });

    const result = await getBlastRadiusHandler(api, { repo: repo.full_name, pr: pr.number });
    const structured = GetBlastRadiusOutputSchema.parse(result.structuredContent);

    expect(structured.changed_symbols).toHaveLength(MAX_BLAST_SYMBOLS);
    expect(structured.omitted_symbols).toBe(5);
    expect(structured.downstream[0]!.callers).toHaveLength(MAX_BLAST_CALLERS_PER_SYMBOL);
    expect(structured.downstream[0]!.omitted_callers).toBe(3);
  });

  it('errors with known repos when the repo is not found — never throws', async () => {
    const api = createFakeApi({
      get: (path) => {
        if (path === '/repos') return [];
        throw new Error(`unexpected GET ${path}`);
      },
    });

    const result = await getBlastRadiusHandler(api, { repo: 'ghost/repo', pr: 1 });

    expect(result.isError).toBe(true);
    const text = result.content?.[0];
    expect(text?.type).toBe('text');
    expect((text as { text: string }).text).toContain('ghost/repo');
  });

  it('errors with known PR numbers when the PR is not found', async () => {
    const repo = makeRepo();
    const api = createFakeApi({
      get: (path) => {
        if (path === '/repos') return [repo];
        if (path === `/repos/${repo.id}/pulls`) return [];
        throw new Error(`unexpected GET ${path}`);
      },
    });

    const result = await getBlastRadiusHandler(api, { repo: repo.full_name, pr: 999 });

    expect(result.isError).toBe(true);
    const text = result.content?.[0];
    expect(text?.type).toBe('text');
    expect((text as { text: string }).text).toContain('999');
  });
});
