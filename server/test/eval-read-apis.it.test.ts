/**
 * WI8 — read APIs: dashboard, history, compare, zero model calls
 * (`docs/plans/eval-pipeline.md` Phase C). Oracle: `specs/eval-pipeline.md`
 * AC-32, AC-33, AC-44, E-16, E-17, and WI8's own content bullets ("trend = one
 * point per batch, carrying batch_id and agent_version") — derived from the
 * plan/spec BEFORE reading `modules/eval/{service,routes,repository*}.ts` for
 * anything beyond exact route paths and field names.
 *
 * Real Postgres (testcontainers) + a mocked `LLMProvider`, following
 * `test/eval-cases.it.test.ts` / `test/agents-versions.it.test.ts`'s harness
 * shape. Batches are produced via the real `POST /agents/:id/eval-runs` route
 * (this file does not re-derive WI7's runner behaviour — see
 * `test/eval-runner-batch.it.test.ts` for that).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[eval-read-apis] Docker not available — skipping integration tests.');
}

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

d('Eval read APIs — dashboard, history, compare (WI8, Phase C)', () => {
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

  function makeApp(llm: MockLLMProvider) {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({ config, db: pg.handle.db, overrides: { llm: { openai: llm, openrouter: llm, anthropic: llm } } });
  }

  async function createAgent(
    app: Awaited<ReturnType<typeof buildApp>>,
    name: string,
    systemPrompt = 'Review the diff.',
  ): Promise<{ id: string; version: number }> {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name, provider: 'openai', model: 'gpt-4o-mini', system_prompt: systemPrompt },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    return { id: body.id, version: body.version };
  }

  async function createCase(ownerId: string, ws = workspaceId): Promise<string> {
    const [row] = await pg.handle.db
      .insert(t.evalCases)
      .values({
        workspaceId: ws,
        ownerKind: 'agent',
        ownerId,
        name: `case-${caseSeq++}`,
        inputDiff: SAMPLE_DIFF,
        inputMeta: { title: 'PR title', body: 'PR body' },
        expectedOutput: PASSING_EXPECTATION,
      })
      .returning();
    return row!.id;
  }

  async function createForeignWorkspaceWithAgent(app: Awaited<ReturnType<typeof buildApp>>) {
    const [ws] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `foreign-${Date.now()}-${Math.random()}` })
      .returning();
    const [agentRow] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId: ws!.id,
        name: 'Foreign Agent',
        provider: 'openai',
        model: 'gpt-4o-mini',
        systemPrompt: 'x',
      })
      .returning();
    return { workspaceId: ws!.id, agentId: agentRow!.id };
  }

  it('AC-44: a foreign-workspace batch id 404s via GET /eval-batches/:id, and a foreign agent id 404s on dashboard/batches/compare', async () => {
    const llm = new MockLLMProvider('openai', { structured: PASSING_REVIEW_FIXTURE });
    const app = await makeApp(llm);
    const { workspaceId: foreignWs, agentId: foreignAgentId } = await createForeignWorkspaceWithAgent(app);

    const [foreignBatch] = await pg.handle.db
      .insert(t.evalBatches)
      .values({
        workspaceId: foreignWs,
        ownerKind: 'agent',
        ownerId: foreignAgentId,
        agentVersion: 1,
        provider: 'openai',
        model: 'gpt-4o-mini',
        status: 'completed',
        casesTotal: 1,
        casesPassed: 1,
        casesFailed: 0,
        recallCases: 1,
        precisionCases: 1,
        citationCases: 1,
      })
      .returning();

    expect((await app.inject({ method: 'GET', url: `/eval-batches/${foreignBatch!.id}` })).statusCode).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: `/agents/${foreignAgentId}/eval-dashboard` })).statusCode,
    ).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/agents/${foreignAgentId}/eval-batches` })).statusCode).toBe(
      404,
    );
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/agents/${foreignAgentId}/eval-compare?base=${foreignBatch!.id}&head=${foreignBatch!.id}`,
        })
      ).statusCode,
    ).toBe(404);

    await app.close();
  });

  it('AC-44: a batch belonging to a DIFFERENT agent in the SAME workspace 404s on compare (never a cross-agent batch id via the query string)', async () => {
    const llm = new MockLLMProvider('openai', { structured: PASSING_REVIEW_FIXTURE });
    const app = await makeApp(llm);
    const agentA = await createAgent(app, 'Agent-compare-A');
    const agentB = await createAgent(app, 'Agent-compare-B');
    await createCase(agentA.id);
    await createCase(agentB.id);

    const batchA = (await app.inject({ method: 'POST', url: `/agents/${agentA.id}/eval-runs` })).json();
    const batchB = (await app.inject({ method: 'POST', url: `/agents/${agentB.id}/eval-runs` })).json();

    const res = await app.inject({
      method: 'GET',
      url: `/agents/${agentA.id}/eval-compare?base=${batchA.id}&head=${batchB.id}`,
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it('AC-33: dashboard/history/batch-detail/compare reads make ZERO LLM calls, regardless of batch count', async () => {
    const llm = new MockLLMProvider('openai', { structured: PASSING_REVIEW_FIXTURE });
    const app = await makeApp(llm);
    const agent = await createAgent(app, 'Agent-zero-calls');
    await createCase(agent.id);

    const batch1 = (await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` })).json();
    await app.inject({ method: 'PUT', url: `/agents/${agent.id}`, payload: { system_prompt: 'changed' } });
    const batch2 = (await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` })).json();

    const callsAfterRuns = llm.calls.length;
    expect(callsAfterRuns).toBeGreaterThan(0);

    await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-dashboard` });
    await app.inject({ method: 'GET', url: '/eval-dashboard' });
    await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-batches` });
    await app.inject({ method: 'GET', url: `/eval-batches/${batch1.id}` });
    await app.inject({
      method: 'GET',
      url: `/agents/${agent.id}/eval-compare?base=${batch1.id}&head=${batch2.id}`,
    });

    expect(llm.calls.length).toBe(callsAfterRuns); // no NEW calls from any read route

    await app.close();
  });

  it('AC-32: compare renders both batches\' PINNED prompts from agent_versions snapshots; a deleted snapshot degrades to a null prompt, never the agent\'s current prompt', async () => {
    const llm = new MockLLMProvider('openai', { structured: PASSING_REVIEW_FIXTURE });
    const app = await makeApp(llm);
    const agent = await createAgent(app, 'Agent-compare-snapshot', 'prompt v1');
    await createCase(agent.id);

    const batch1 = (await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` })).json();
    expect(batch1.agent_version).toBe(1);

    // Delete the v1 snapshot directly — simulates a since-deleted agent_versions row.
    await pg.handle.db
      .delete(t.agentVersions)
      .where(and(eq(t.agentVersions.agentId, agent.id), eq(t.agentVersions.version, 1)));

    await app.inject({ method: 'PUT', url: `/agents/${agent.id}`, payload: { system_prompt: 'prompt v2' } });
    await createCase(agent.id);
    const batch2 = (await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` })).json();
    expect(batch2.agent_version).toBe(2);

    // A THIRD config change after batch2 — the agent's CURRENT prompt now
    // diverges from what batch2 actually ran with. head_prompt must still be
    // the v2 SNAPSHOT ("prompt v2"), never this newer current prompt.
    await app.inject({ method: 'PUT', url: `/agents/${agent.id}`, payload: { system_prompt: 'prompt v3 (current)' } });

    const compare = (
      await app.inject({
        method: 'GET',
        url: `/agents/${agent.id}/eval-compare?base=${batch1.id}&head=${batch2.id}`,
      })
    ).json();

    expect(compare.base_prompt).toBeNull(); // v1 snapshot is gone — degrade, don't substitute
    expect(compare.head_prompt).toBe('prompt v2'); // the batch's OWN pinned snapshot
    expect(compare.head_prompt).not.toBe('prompt v3 (current)'); // never the live prompt
    // metrics still render even with a missing base snapshot. `runForAgent`
    // runs the agent's WHOLE case set each time, so batch2 (run after a
    // second case was created) covers both cases — 2, not 1.
    expect(compare.base.cases_total).toBe(1);
    expect(compare.head.cases_total).toBe(2);

    await app.close();
  });

  it('WI8: trend carries exactly one point per batch, each with its own batch_id and agent_version, oldest-first', async () => {
    const llm = new MockLLMProvider('openai', { structured: PASSING_REVIEW_FIXTURE });
    const app = await makeApp(llm);
    const agent = await createAgent(app, 'Agent-trend');
    await createCase(agent.id);
    const batch1 = (await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` })).json();
    await app.inject({ method: 'PUT', url: `/agents/${agent.id}`, payload: { system_prompt: 'v2' } });
    await createCase(agent.id);
    const batch2 = (await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` })).json();

    const dashboard = (
      await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-dashboard` })
    ).json();

    expect(dashboard.trend).toHaveLength(2);
    expect(dashboard.trend[0].batch_id).toBe(batch1.id);
    expect(dashboard.trend[0].agent_version).toBe(1);
    expect(dashboard.trend[1].batch_id).toBe(batch2.id);
    expect(dashboard.trend[1].agent_version).toBe(2);

    await app.close();
  });

  it('E-17: dashboard delta is null after only ONE batch (never a zero delta)', async () => {
    const llm = new MockLLMProvider('openai', { structured: PASSING_REVIEW_FIXTURE });
    const app = await makeApp(llm);
    const agent = await createAgent(app, 'Agent-one-batch');
    await createCase(agent.id);
    await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });

    const dashboard = (
      await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-dashboard` })
    ).json();
    expect(dashboard.delta).toBeNull();

    await app.close();
  });

  it('E-17: dashboard delta becomes a real (non-null) object once a SECOND batch exists', async () => {
    const llm = new MockLLMProvider('openai', { structured: PASSING_REVIEW_FIXTURE });
    const app = await makeApp(llm);
    const agent = await createAgent(app, 'Agent-two-batches');
    await createCase(agent.id);
    await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    await createCase(agent.id);
    await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });

    const dashboard = (
      await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-dashboard` })
    ).json();
    expect(dashboard.delta).not.toBeNull();
    expect(typeof dashboard.delta.recall).toBe('number');

    await app.close();
  });
});
