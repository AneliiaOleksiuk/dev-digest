/**
 * WI7 — version-pinned batch runner (`docs/plans/eval-pipeline.md` Phase C).
 * Oracle: `specs/eval-pipeline.md` AC-14, AC-15, AC-16, AC-19, AC-20, AC-21,
 * AC-22, AC-45, E-14, E-16, and the Non-functional A06 cost-abuse cap — derived
 * from the plan/spec BEFORE reading `modules/eval/{runner,service,routes}.ts`
 * for anything beyond exact route paths, field names and error codes.
 *
 * `implementer`'s own `test/eval-runner.test.ts` already covers AC-18/D-2 (the
 * assembled `ReviewInput` carries no callers/repoMap/specs/intent) via a
 * mocked `reviewPullRequest` — deliberately NOT duplicated here. This file
 * exercises the runner through the real HTTP routes against a real Postgres
 * (testcontainers) with a scripted/mocked `LLMProvider`, following
 * `test/eval-cases.it.test.ts` / `test/brief.it.test.ts`'s harness shape.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type { LLMProvider, StructuredRequest, StructuredResult, CompletionRequest, CompletionResult, ModelInfo } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import { MAX_CASES_PER_BATCH } from '../src/modules/eval/constants.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[eval-runner-batch] Docker not available — skipping integration tests.');
}

const testConfig = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
const prodConfig = () =>
  loadConfig({ ...process.env, NODE_ENV: 'production', LOG_LEVEL: 'silent' } as NodeJS.ProcessEnv);

/** A diff whose only hunk touches `src/x.ts` line 1 — grounds a finding at
 *  file:src/x.ts, start_line:1, end_line:1. */
const SAMPLE_DIFF =
  'diff --git a/src/x.ts b/src/x.ts\n--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1,1 +1,1 @@\n-old\n+new';

const PASSING_EXPECTATION = {
  version: 1,
  must_find: [{ file: 'src/x.ts', start_line: 1, end_line: 1, match_scope: 'range' }],
  must_not_flag: [],
};

const PASSING_REVIEW_FIXTURE = {
  verdict: 'comment',
  summary: 'looks fine',
  score: 90,
  findings: [
    {
      id: 'f1',
      severity: 'WARNING',
      category: 'style',
      title: 'A minor note',
      file: 'src/x.ts',
      start_line: 1,
      end_line: 1,
      rationale: 'r',
      confidence: 0.9,
    },
  ],
};

/**
 * Wraps a `MockLLMProvider` to script failures/delays/null-cost per call,
 * without touching `src/adapters/mocks.ts` (production code, out of
 * `test-writer`'s write scope). `calls.length` after a batch run is exactly
 * the number of `completeStructured` calls the review engine itself made
 * (AC-22 — scoring adds none).
 */
class ScriptedLLMProvider implements LLMProvider {
  readonly id: 'openai' | 'anthropic' = 'openai';
  calls: unknown[] = [];
  private n = 0;

  constructor(
    private inner: MockLLMProvider,
    private opts: { failAtCalls?: number[]; failAll?: boolean; delayMs?: number; nullCost?: boolean } = {},
  ) {}

  async listModels(): Promise<ModelInfo[]> {
    return this.inner.listModels();
  }
  async complete(req: CompletionRequest): Promise<CompletionResult> {
    return this.inner.complete(req);
  }
  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.n++;
    this.calls.push(req);
    if (this.opts.delayMs) await new Promise((r) => setTimeout(r, this.opts.delayMs));
    if (this.opts.failAll || this.opts.failAtCalls?.includes(this.n)) {
      throw new Error(`simulated provider failure on call ${this.n}`);
    }
    const result = await this.inner.completeStructured(req);
    return this.opts.nullCost ? { ...result, costUsd: null } : result;
  }
  async embed(texts: string[]): Promise<number[][]> {
    return this.inner.embed(texts);
  }
}

d('Eval batch runner — WI7 (Phase C)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let caseSeq = 0;

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp(llm: LLMProvider, config = testConfig()) {
    return buildApp({ config, db: pg.handle.db, overrides: { llm: { openai: llm, openrouter: llm, anthropic: llm } } });
  }

  async function createAgent(app: Awaited<ReturnType<typeof buildApp>>, name: string): Promise<{ id: string; version: number }> {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name, provider: 'openai', model: 'gpt-4o-mini', system_prompt: 'Review the diff.' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    return { id: body.id, version: body.version };
  }

  /** Inserts eval_cases rows directly (bypassing the write route, which this
   *  file isn't testing) so fixtures are exact and fast — same pattern
   *  `test/eval-cases.it.test.ts` uses for cross-workspace fixtures. */
  async function createCases(
    ownerId: string,
    n: number,
    overrides: { inputDiff?: string; expectedOutput?: unknown } = {},
  ): Promise<string[]> {
    const rows = await pg.handle.db
      .insert(t.evalCases)
      .values(
        Array.from({ length: n }, () => ({
          workspaceId,
          ownerKind: 'agent' as const,
          ownerId,
          name: `case-${caseSeq++}`,
          inputDiff: overrides.inputDiff ?? SAMPLE_DIFF,
          inputMeta: { title: 'PR title', body: 'PR body' },
          expectedOutput: overrides.expectedOutput ?? PASSING_EXPECTATION,
        })),
      )
      .returning();
    return rows.map((r) => r.id);
  }

  it('AC-14/AC-19: 8 cases → 8 eval_runs rows sharing one batch_id and one recorded agent_version, with per-case metrics/actual_output/duration_ms/cost_usd persisted', async () => {
    const provider = new ScriptedLLMProvider(new MockLLMProvider('openai', { structured: PASSING_REVIEW_FIXTURE }));
    const app = await makeApp(provider);
    const agent = await createAgent(app, 'Agent-8cases');
    await createCases(agent.id, 8);

    const res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(res.statusCode).toBe(201);
    const batch = res.json();
    expect(batch.status).toBe('completed');
    expect(batch.cases_total).toBe(8);
    expect(batch.agent_version).toBe(agent.version);

    const detail = (await app.inject({ method: 'GET', url: `/eval-batches/${batch.id}` })).json();
    expect(detail.runs).toHaveLength(8);
    for (const run of detail.runs) {
      expect(run.batch_id).toBe(batch.id);
      expect(run.pass).toBe(true);
      expect(run.recall).toBe(1);
      expect(run.actual_output).toBeTruthy();
      expect(typeof run.duration_ms).toBe('number');
      expect(run.cost_usd).toBeGreaterThan(0);
      expect(run.error).toBeFalsy();
    }

    await app.close();
  });

  it('POST /eval-cases/:id/run — a single case runs as a one-case batch with the SAME invariants (one batch_id, one run)', async () => {
    const provider = new ScriptedLLMProvider(new MockLLMProvider('openai', { structured: PASSING_REVIEW_FIXTURE }));
    const app = await makeApp(provider);
    const agent = await createAgent(app, 'Agent-single');
    const [caseId] = await createCases(agent.id, 1);

    const res = await app.inject({ method: 'POST', url: `/eval-cases/${caseId}/run` });
    expect(res.statusCode).toBe(201);
    const batch = res.json();
    expect(batch.cases_total).toBe(1);
    expect(batch.agent_version).toBe(agent.version);

    const detail = (await app.inject({ method: 'GET', url: `/eval-batches/${batch.id}` })).json();
    expect(detail.runs).toHaveLength(1);
    expect(detail.runs[0].case_id).toBe(caseId);

    await app.close();
  });

  it('AC-22: the provider\'s completeStructured call count equals exactly the number of cases — scoring adds no calls', async () => {
    const provider = new ScriptedLLMProvider(new MockLLMProvider('openai', { structured: PASSING_REVIEW_FIXTURE }));
    const app = await makeApp(provider);
    const agent = await createAgent(app, 'Agent-callcount');
    await createCases(agent.id, 5);

    await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(provider.calls).toHaveLength(5); // single-pass, one call per case

    await app.close();
  });

  it('AC-20: a provider that throws on the 3rd case still produces one eval_runs row per case, and the batch stays "completed"', async () => {
    const provider = new ScriptedLLMProvider(new MockLLMProvider('openai', { structured: PASSING_REVIEW_FIXTURE }), {
      failAtCalls: [3],
    });
    const app = await makeApp(provider);
    const agent = await createAgent(app, 'Agent-partial-fail');
    await createCases(agent.id, 8);

    const res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(res.statusCode).toBe(201);
    const batch = res.json();
    expect(batch.status).toBe('completed');
    expect(batch.cases_total).toBe(8);
    expect(batch.cases_failed).toBe(1);
    expect(batch.cases_passed).toBe(7);

    const detail = (await app.inject({ method: 'GET', url: `/eval-batches/${batch.id}` })).json();
    expect(detail.runs).toHaveLength(8); // ALL 8 persisted, including the failed one
    const failed = detail.runs.filter((r: { error: string | null }) => r.error);
    expect(failed).toHaveLength(1);
    expect(failed[0].pass).toBeNull();
    expect(failed[0].recall).toBeNull();

    await app.close();
  });

  it('AC-21: an all-throwing provider produces a "failed" batch with null aggregate metrics (never zeros), while still persisting one run per case', async () => {
    const provider = new ScriptedLLMProvider(new MockLLMProvider('openai', { structured: PASSING_REVIEW_FIXTURE }), {
      failAll: true,
    });
    const app = await makeApp(provider);
    const agent = await createAgent(app, 'Agent-all-fail');
    await createCases(agent.id, 3);

    const res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(res.statusCode).toBe(201);
    const batch = res.json();
    expect(batch.status).toBe('failed');
    expect(batch.recall).toBeNull();
    expect(batch.precision).toBeNull();
    expect(batch.citation_accuracy).toBeNull();
    expect(batch.cost_usd).toBeNull();
    expect(batch.findings_total).toBeNull();
    expect(typeof batch.error).toBe('string'); // explicit failed state, not silence

    const detail = (await app.inject({ method: 'GET', url: `/eval-batches/${batch.id}` })).json();
    expect(detail.runs).toHaveLength(3);
    expect(detail.runs.every((r: { error: string | null }) => r.error)).toBe(true);

    await app.close();
  });

  it('E-16: a provider that reports no cost renders the batch\'s cost_usd as null, never an invented figure', async () => {
    const provider = new ScriptedLLMProvider(new MockLLMProvider('openai', { structured: PASSING_REVIEW_FIXTURE }), {
      nullCost: true,
    });
    const app = await makeApp(provider);
    const agent = await createAgent(app, 'Agent-nullcost');
    await createCases(agent.id, 2);

    const res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    const batch = res.json();
    expect(batch.status).toBe('completed');
    expect(batch.cost_usd).toBeNull();

    await app.close();
  });

  it('A06/Q-4: a case set larger than MAX_CASES_PER_BATCH is rejected (422) and writes NO batch row', async () => {
    const provider = new ScriptedLLMProvider(new MockLLMProvider('openai', { structured: PASSING_REVIEW_FIXTURE }));
    const app = await makeApp(provider);
    const agent = await createAgent(app, 'Agent-oversized');
    await createCases(agent.id, MAX_CASES_PER_BATCH + 1);

    const before = await pg.handle.db.select().from(t.evalBatches).where(eq(t.evalBatches.ownerId, agent.id));
    const res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(res.statusCode).toBe(422);
    const after = await pg.handle.db.select().from(t.evalBatches).where(eq(t.evalBatches.ownerId, agent.id));
    expect(after).toHaveLength(before.length); // refusal, not a partial batch
    expect(provider.calls).toHaveLength(0); // never even reached the provider

    await app.close();
  });

  it('E-14: a second concurrent run request for the SAME agent is rejected (409) while the first is still in flight (in-process guard)', async () => {
    const provider = new ScriptedLLMProvider(new MockLLMProvider('openai', { structured: PASSING_REVIEW_FIXTURE }), {
      delayMs: 60,
    });
    const app = await makeApp(provider);
    const agent = await createAgent(app, 'Agent-concurrent');
    await createCases(agent.id, 3);

    const first = app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    await new Promise((r) => setTimeout(r, 15)); // let the first request acquire the guard
    const second = app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });

    const [res1, res2] = await Promise.all([first, second]);
    const statuses = [res1.statusCode, res2.statusCode].sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409]);

    await app.close();
  }, 15_000);

  it('AC-15/AC-16: a config change that lands WHILE a batch is running does not affect that batch\'s already-pinned agent_version', async () => {
    const provider = new ScriptedLLMProvider(new MockLLMProvider('openai', { structured: PASSING_REVIEW_FIXTURE }), {
      delayMs: 50,
    });
    const app = await makeApp(provider);
    const agent = await createAgent(app, 'Agent-midbatch');
    expect(agent.version).toBe(1);
    await createCases(agent.id, 3);

    const runPromise = app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    await new Promise((r) => setTimeout(r, 15)); // batch has opened and pinned v1 by now
    const patchRes = await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}`,
      payload: { system_prompt: 'A completely different prompt now.' },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().version).toBe(2); // the config change DID bump the agent

    const runRes = await runPromise;
    expect(runRes.statusCode).toBe(201);
    // …but the already-running batch still recorded the version pinned AT OPEN.
    expect(runRes.json().agent_version).toBe(1);

    await app.close();
  }, 15_000);

  it('AC-45: the 11th run request within a minute for the same case is rate-limited (429) at 10/min (nodeEnv: production harness — rate limiting is inert under NODE_ENV=test)', async () => {
    const provider = new ScriptedLLMProvider(new MockLLMProvider('openai', { structured: PASSING_REVIEW_FIXTURE }));
    const app = await makeApp(provider, prodConfig());
    const agent = await createAgent(app, 'Agent-ratelimit');
    const [caseId] = await createCases(agent.id, 1);

    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await app.inject({ method: 'POST', url: `/eval-cases/${caseId}/run` });
      statuses.push(res.statusCode);
    }

    expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true);
    expect(statuses[10]).toBe(429);

    await app.close();
  }, 20_000);
});
