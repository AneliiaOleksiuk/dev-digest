import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { MultiAgentRun } from '@devdigest/shared';
import type { LLMProvider } from '@devdigest/shared';

/**
 * L07 (SPEC-04) — integration tests for the batch READ/assembly service
 * (`multi-agent-read.ts`, docs/plans/spec-04-multi-agent-review.md WI7).
 *
 * Oracle derived from specs/SPEC-04-multi-agent-review.md AC-15, AC-20,
 * AC-21, AC-23, AC-32, E-8, E-9, BEFORE reading `multi-agent-read.ts` in
 * depth.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const REVIEW_FIXTURE = {
  verdict: 'request_changes',
  summary: 'Found one thing.',
  score: 80,
  findings: [
    {
      id: 'f-a',
      severity: 'WARNING',
      category: 'security',
      title: 'Hardcoded value',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'looks sensitive',
      confidence: 0.7,
      kind: 'finding',
    },
  ],
};

const INTENT_FIXTURE = {
  intent: 'Add rate limiting.',
  in_scope: ['rate limiting'],
  out_of_scope: [],
  confidence: 0.8,
  missing_context: [],
  risk_areas: [],
};

class FailingLLMProvider implements LLMProvider {
  readonly id: 'anthropic' = 'anthropic';
  async listModels() {
    return [{ id: 'claude-x', provider: 'anthropic' as const }];
  }
  async complete(): Promise<never> {
    throw new Error('mock provider error');
  }
  async completeStructured(): Promise<never> {
    throw new Error('mock provider failure: simulated outage');
  }
  async embed(texts: string[]) {
    return texts.map(() => new Array(1536).fill(0));
  }
}

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `ma-read-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 2000 + repoSeq,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: `sha-r-${repoSeq}`,
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: null,
    })
    .returning();
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/config.ts',
    additions: 1,
    deletions: 0,
    patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
  });
  return { repo: repo!, pr: pr! };
}

const TERMINAL = new Set(['done', 'failed', 'cancelled']);
async function waitForBatchTerminal(
  db: PgFixture['handle']['db'],
  multiAgentRunId: string,
  expectedCount: number,
  timeoutMs = 10_000,
) {
  const start = Date.now();
  for (;;) {
    const rows = await db.select().from(t.agentRuns).where(eq(t.agentRuns.multiAgentRunId, multiAgentRunId));
    if (rows.length >= expectedCount && rows.every((r) => TERMINAL.has(r.status ?? ''))) return rows;
    if (Date.now() - start > timeoutMs) return rows;
    await new Promise((r) => setTimeout(r, 25));
  }
}

d('MultiAgentReadService (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function appWith(overridesLlm: Record<string, unknown> = {}) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: {
          openai: new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }),
          openrouter: new MockLLMProvider('openai', { structured: INTENT_FIXTURE }),
          ...overridesLlm,
        },
      },
    });
  }

  async function createAgent(app: Awaited<ReturnType<typeof appWith>>, name: string, provider = 'openai') {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name, provider, model: provider === 'anthropic' ? 'claude-x' : 'gpt-4.1', system_prompt: 'p' },
    });
    return res.json();
  }

  it('response validates against the real MultiAgentRun zod contract, and total_duration_ms is the wall-clock span (not a sum) while total_cost_usd sums known costs and total_cost_partial reflects a null child cost (AC-15)', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const a1 = await createAgent(app, 'R1');
    const a2 = await createAgent(app, 'R2');
    const a3 = await createAgent(app, 'R3');

    const start = (
      await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/multi-agent-run`,
        payload: { agent_ids: [a1.id, a2.id, a3.id] },
      })
    ).json();
    const children = await waitForBatchTerminal(pg.handle.db, start.multi_agent_run_id, 3);
    expect(children.every((c) => c.status === 'done')).toBe(true);

    // Overwrite the three children with deterministic timing/cost so the
    // wall-clock-span vs sum distinction (and the partial-cost flag) is
    // asserted precisely rather than depending on real mock timing.
    const T0 = new Date('2026-01-01T00:00:00.000Z').getTime();
    const byAgent = new Map(children.map((c) => [c.agentId, c]));
    await pg.handle.db
      .update(t.agentRuns)
      .set({ ranAt: new Date(T0), durationMs: 5000, costUsd: 0.01 })
      .where(eq(t.agentRuns.id, byAgent.get(a1.id)!.id));
    await pg.handle.db
      .update(t.agentRuns)
      .set({ ranAt: new Date(T0 + 2000), durationMs: 4000, costUsd: 0.02 })
      .where(eq(t.agentRuns.id, byAgent.get(a2.id)!.id));
    // a3 finishes null-cost — simulates a provider that never reported cost.
    await pg.handle.db
      .update(t.agentRuns)
      .set({ ranAt: new Date(T0 + 1000), durationMs: 3000, costUsd: null })
      .where(eq(t.agentRuns.id, byAgent.get(a3.id)!.id));

    const res = await app.inject({ method: 'GET', url: `/multi-agent-runs/${start.multi_agent_run_id}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Validates against the REAL vendored contract, not a hand-rolled shape check.
    expect(() => MultiAgentRun.parse(body)).not.toThrow();

    // Finishes: a1 @ T0+5000, a2 @ T0+6000, a3 @ T0+4000. Starts: T0, T0+2000, T0+1000.
    // Span = max(finish) - min(start) = (T0+6000) - T0 = 6000.
    expect(body.total_duration_ms).toBe(6000);
    // NOT the sum of durations (5000+4000+3000=12000) — proves wall-clock,
    // not additive, semantics.
    expect(body.total_duration_ms).not.toBe(12_000);

    expect(body.total_cost_usd).toBeCloseTo(0.03, 5);
    expect(body.total_cost_partial).toBe(true);

    await app.close();
  });

  it('AC-20/AC-21: a failed column carries the persisted error in `error` (never in `summary`); the batch itself is not reported as failed', async () => {
    const app = await appWith({ anthropic: new FailingLLMProvider() });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const good = await createAgent(app, 'Good', 'openai');
    const bad = await createAgent(app, 'Bad', 'anthropic');

    const start = (
      await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/multi-agent-run`,
        payload: { agent_ids: [good.id, bad.id] },
      })
    ).json();
    await waitForBatchTerminal(pg.handle.db, start.multi_agent_run_id, 2);

    const res = await app.inject({ method: 'GET', url: `/multi-agent-runs/${start.multi_agent_run_id}` });
    const body = res.json();
    expect(() => MultiAgentRun.parse(body)).not.toThrow();

    const goodCol = body.columns.find((c: { agent_id: string }) => c.agent_id === good.id);
    const badCol = body.columns.find((c: { agent_id: string }) => c.agent_id === bad.id);

    expect(goodCol.status).toBe('done');
    expect(goodCol.verdict).toBe('request_changes');
    // Score is derived from grounded findings by the scoring engine, not the
    // model's self-reported 80 — assert it's a real measured int, not the
    // exact formula (covered elsewhere by reviews-helpers.test.ts).
    expect(typeof goodCol.score).toBe('number');
    expect(goodCol.findings).toHaveLength(1);
    expect(goodCol.duration_ms).toBeGreaterThanOrEqual(0);

    expect(badCol.status).toBe('failed');
    expect(badCol.error).toContain('simulated outage');
    // `summary` is never overloaded with the error text.
    expect(badCol.summary).toBeNull();

    // No top-level "failed" flag anywhere on the batch — columns carry their
    // own state; nothing here asserts a batch-wide failure.
    expect(body).not.toHaveProperty('status');
    expect(body).not.toHaveProperty('failed');

    await app.close();
  });

  it('AC-21 (cancelled column): a cancelled child carries its persisted error/cancellation note in `error`', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const a1 = await createAgent(app, 'C1');
    const a2 = await createAgent(app, 'C2');
    const start = (
      await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/multi-agent-run`,
        payload: { agent_ids: [a1.id, a2.id] },
      })
    ).json();
    const children = await waitForBatchTerminal(pg.handle.db, start.multi_agent_run_id, 2);
    const byAgent = new Map(children.map((c) => [c.agentId, c]));

    // Simulate a cancelled run (e.g. via POST /runs/:id/cancel mid-flight) by
    // directly setting the terminal state this action would have persisted.
    await pg.handle.db
      .update(t.agentRuns)
      .set({ status: 'cancelled', error: 'Cancelled by user' })
      .where(eq(t.agentRuns.id, byAgent.get(a2.id)!.id));

    const res = await app.inject({ method: 'GET', url: `/multi-agent-runs/${start.multi_agent_run_id}` });
    const body = res.json();
    expect(() => MultiAgentRun.parse(body)).not.toThrow();
    const cancelledCol = body.columns.find((c: { agent_id: string }) => c.agent_id === a2.id);
    expect(cancelledCol.status).toBe('cancelled');
    expect(cancelledCol.error).toBe('Cancelled by user');

    await app.close();
  });

  it('AC-23/AC-32: reads are derived at READ TIME and never mutate persisted findings — repeated reads leave the findings row count unchanged', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const a1 = await createAgent(app, 'D1');
    const a2 = await createAgent(app, 'D2');
    const start = (
      await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/multi-agent-run`,
        payload: { agent_ids: [a1.id, a2.id] },
      })
    ).json();
    await waitForBatchTerminal(pg.handle.db, start.multi_agent_run_id, 2);

    const countFindings = async () => (await pg.handle.db.select().from(t.findings)).length;
    const before = await countFindings();

    await app.inject({ method: 'GET', url: `/multi-agent-runs/${start.multi_agent_run_id}` });
    await app.inject({ method: 'GET', url: `/multi-agent-runs/${start.multi_agent_run_id}` });
    await app.inject({ method: 'GET', url: `/multi-agent-runs/${start.multi_agent_run_id}` });

    const after = await countFindings();
    expect(after).toBe(before);

    await app.close();
  });

  it('E-8: a child left in a stale `running` status (dead-process reap scenario) still yields a coherent mixed terminal read instead of hanging', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const a1 = await createAgent(app, 'S1');
    const a2 = await createAgent(app, 'S2');
    const start = (
      await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/multi-agent-run`,
        payload: { agent_ids: [a1.id, a2.id] },
      })
    ).json();
    const children = await waitForBatchTerminal(pg.handle.db, start.multi_agent_run_id, 2);
    const byAgent = new Map(children.map((c) => [c.agentId, c]));

    // Simulate a dead-process orphan: one child never got its terminal state
    // written (durationMs/costUsd never set), status still 'running'.
    await pg.handle.db
      .update(t.agentRuns)
      .set({ status: 'running', durationMs: null, costUsd: null })
      .where(eq(t.agentRuns.id, byAgent.get(a2.id)!.id));

    const res = await app.inject({ method: 'GET', url: `/multi-agent-runs/${start.multi_agent_run_id}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(() => MultiAgentRun.parse(body)).not.toThrow();

    const stuckCol = body.columns.find((c: { agent_id: string }) => c.agent_id === a2.id);
    const doneCol = body.columns.find((c: { agent_id: string }) => c.agent_id === a1.id);
    expect(stuckCol.status).toBe('running');
    expect(stuckCol.duration_ms).toBeNull();
    // The OTHER column still renders its own independent terminal state —
    // the batch does not collapse into one global "running" state.
    expect(doneCol.status).toBe('done');
    expect(body.total_cost_partial).toBe(true);

    await app.close();
  });

  it('E-9: a batch read is addressed by a SPECIFIC batch id — an unknown id, and a foreign workspace\'s real id, both 404 (never "latest for this PR")', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const a1 = await createAgent(app, 'U1');

    const first = (
      await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/multi-agent-run`,
        payload: { agent_ids: [a1.id] },
      })
    ).json();
    await waitForBatchTerminal(pg.handle.db, first.multi_agent_run_id, 1);

    // A second, later batch on the SAME pr — proves "addressed by id" rather
    // than "the latest batch for this PR": requesting the FIRST id must still
    // return the first batch, not silently redirect to the second.
    const a2 = await createAgent(app, 'U2');
    const second = (
      await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/multi-agent-run`,
        payload: { agent_ids: [a2.id] },
      })
    ).json();
    await waitForBatchTerminal(pg.handle.db, second.multi_agent_run_id, 1);

    const readFirst = await app.inject({ method: 'GET', url: `/multi-agent-runs/${first.multi_agent_run_id}` });
    expect(readFirst.statusCode).toBe(200);
    expect(readFirst.json().id).toBe(first.multi_agent_run_id);
    expect(readFirst.json().columns.map((c: { agent_id: string }) => c.agent_id)).toEqual([a1.id]);

    const missing = '00000000-0000-0000-0000-000000000000';
    const unknown = await app.inject({ method: 'GET', url: `/multi-agent-runs/${missing}` });
    expect(unknown.statusCode).toBe(404);

    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: 'ma-read-other-ws' }).returning();
    const [foreignRun] = await pg.handle.db
      .insert(t.multiAgentRuns)
      .values({ workspaceId: otherWs!.id, prId: pr.id })
      .returning();
    const foreignRead = await app.inject({ method: 'GET', url: `/multi-agent-runs/${foreignRun!.id}` });
    expect(foreignRead.statusCode).toBe(404);

    await app.close();
  });
});
