import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

/**
 * SPEC-06 — integration tests for `GET /agents/:id/stats` and
 * `GET /agents/performance` (Testcontainers pg).
 *
 * Oracle derived from docs/plans/spec-06-agent-performance-dashboard.md
 * (Test plan → Coverage test-writer must add: AC-18, AC-2, AC-11, AC-9,
 * NFR-1, AC-4/NFR-2, AC-38) and specs/SPEC-06-agent-performance-dashboard.md
 * (AC-2/AC-3/AC-4/AC-9/AC-11/AC-18/AC-38/NFR-1/NFR-2/D-17) BEFORE reading
 * `run.repo.ts`'s `perfStatsForAgents` / `modules/agents/performance.ts` /
 * `routes.ts` in depth beyond the WI2/WI4/WI7 wiring facts already confirmed
 * (route paths, response shape, `IdParams`/`RangeQuery` schemas).
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `perf-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 4000 + repoSeq,
      title: 'Agent Performance fixture PR',
      author: 'marisa.koch',
      branch: `feat/perf-${repoSeq}`,
      base: 'main',
      headSha: `sha-perf-${repoSeq}`,
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: null,
    })
    .returning();
  return { repo: repo!, pr: pr! };
}

async function insertRun(
  db: PgFixture['handle']['db'],
  opts: {
    workspaceId: string;
    agentId: string | null;
    prId: string | null;
    model?: string | null;
    costUsd?: number | null;
    durationMs?: number | null;
    ranAt: Date;
    status?: 'done' | 'failed' | 'cancelled' | 'running';
  },
) {
  const [row] = await db
    .insert(t.agentRuns)
    .values({
      workspaceId: opts.workspaceId,
      agentId: opts.agentId,
      prId: opts.prId,
      provider: 'openai',
      model: opts.model === undefined ? 'gpt-4.1' : opts.model,
      ranAt: opts.ranAt,
      durationMs: opts.durationMs === undefined ? 1000 : opts.durationMs,
      costUsd: opts.costUsd === undefined ? 0.01 : opts.costUsd,
      status: opts.status ?? 'done',
      findingsCount: 0,
      source: 'local',
    })
    .returning();
  return row!;
}

async function insertReview(
  db: PgFixture['handle']['db'],
  opts: { workspaceId: string; prId: string; agentId: string | null; runId: string; kind?: 'review' | 'summary' },
) {
  const [row] = await db
    .insert(t.reviews)
    .values({
      workspaceId: opts.workspaceId,
      prId: opts.prId,
      agentId: opts.agentId,
      runId: opts.runId,
      kind: opts.kind ?? 'review',
      verdict: 'approve',
      summary: 's',
      score: 90,
      model: 'gpt-4.1',
    })
    .returning();
  return row!;
}

async function insertFinding(
  db: PgFixture['handle']['db'],
  opts: { reviewId: string; severity: 'CRITICAL' | 'WARNING' | 'SUGGESTION'; accepted?: boolean; dismissed?: boolean },
) {
  await db.insert(t.findings).values({
    reviewId: opts.reviewId,
    file: 'src/a.ts',
    startLine: 1,
    endLine: 1,
    severity: opts.severity,
    category: 'bug',
    title: 'Fixture finding',
    rationale: 'fixture',
    confidence: 0.8,
    acceptedAt: opts.accepted ? new Date() : null,
    dismissedAt: opts.dismissed ? new Date() : null,
  });
}

d('SPEC-06 Agent Performance / Stats (Testcontainers pg)', () => {
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
        llm: { openai: new MockLLMProvider('openai'), anthropic: new MockLLMProvider('anthropic'), ...overridesLlm },
      },
    });
  }

  async function createAgent(app: Awaited<ReturnType<typeof appWith>>, name: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name, provider: 'openai', model: 'gpt-4.1', system_prompt: 'p' },
    });
    return res.json();
  }

  it('AC-18 (the spec\'s central check): for the SAME agent and range, GET /agents/performance\'s row and GET /agents/:id/stats agree field-by-field on runs, avg_cost_usd, avg_latency_ms and accept_rate', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = await createAgent(app, 'AC-18 Agent');

    const day1 = new Date('2026-03-01T10:00:00.000Z');
    const day2 = new Date('2026-03-01T14:00:00.000Z');
    const run1 = await insertRun(pg.handle.db, { workspaceId, agentId: agent.id, prId: pr.id, costUsd: 0.1, durationMs: 2000, ranAt: day1 });
    const run2 = await insertRun(pg.handle.db, { workspaceId, agentId: agent.id, prId: pr.id, costUsd: 0.2, durationMs: 4000, ranAt: day2 });
    const review1 = await insertReview(pg.handle.db, { workspaceId, prId: pr.id, agentId: agent.id, runId: run1.id });
    await insertFinding(pg.handle.db, { reviewId: review1.id, severity: 'CRITICAL', accepted: true });
    const review2 = await insertReview(pg.handle.db, { workspaceId, prId: pr.id, agentId: agent.id, runId: run2.id });
    await insertFinding(pg.handle.db, { reviewId: review2.id, severity: 'WARNING', dismissed: true });

    const qs = 'range=custom&start=2026-03-01&end=2026-03-01';
    const statsRes = await app.inject({ method: 'GET', url: `/agents/${agent.id}/stats?${qs}` });
    const perfRes = await app.inject({ method: 'GET', url: `/agents/performance?${qs}` });
    expect(statsRes.statusCode).toBe(200);
    expect(perfRes.statusCode).toBe(200);

    const stats = statsRes.json();
    const perf = perfRes.json();
    const row = perf.agents.find((r: { agent_id: string }) => r.agent_id === agent.id);
    expect(row).toBeDefined();

    // Field-by-field equality — the spec's central correctness claim.
    expect(row.runs).toBe(stats.runs);
    expect(row.avg_cost_usd).toBe(stats.avg_cost_usd);
    expect(row.avg_latency_ms).toBe(stats.avg_latency_ms);
    expect(row.accept_rate).toBe(stats.accept_rate);

    // Sanity: these are the real computed numbers, not both coincidentally null/0.
    expect(stats.runs).toBe(2);
    expect(stats.avg_cost_usd).toBeCloseTo(0.15, 10);
    expect(stats.avg_latency_ms).toBe(3000);
    expect(stats.accept_rate).toBe(0.5);

    await app.close();
  });

  it('AC-2/AC-3: range bounds are a half-open [start, end) UTC interval — a run exactly at the resolved start is INCLUDED, one exactly at the resolved end is EXCLUDED', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = await createAgent(app, 'Boundary Agent');

    // range=custom&start=2026-04-10&end=2026-04-10 resolves to
    // [2026-04-10T00:00:00Z, 2026-04-11T00:00:00Z) — see helpers.ts resolveRange.
    await insertRun(pg.handle.db, { workspaceId, agentId: agent.id, prId: pr.id, ranAt: new Date('2026-04-10T00:00:00.000Z') });
    await insertRun(pg.handle.db, { workspaceId, agentId: agent.id, prId: pr.id, ranAt: new Date('2026-04-11T00:00:00.000Z') });

    const res = await app.inject({ method: 'GET', url: `/agents/${agent.id}/stats?range=custom&start=2026-04-10&end=2026-04-10` });
    expect(res.statusCode).toBe(200);
    expect(res.json().runs).toBe(1);

    await app.close();
  });

  it('AC-11: a LOCAL run contributes a non-zero severity breakdown via the findings⋈reviews join — never the CI-only agent_runs.critical/.warning/.suggestion columns (NULL for every local run)', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = await createAgent(app, 'Local Severity Agent');
    const run = await insertRun(pg.handle.db, { workspaceId, agentId: agent.id, prId: pr.id, ranAt: new Date('2026-05-01T00:00:00.000Z') });

    // Confirm the CI-only columns really are NULL for this local run — the
    // exact false-positive source AC-11/D-6 guards against.
    const [raw] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, run.id));
    expect(raw!.critical).toBeNull();
    expect(raw!.warning).toBeNull();
    expect(raw!.suggestion).toBeNull();

    const review = await insertReview(pg.handle.db, { workspaceId, prId: pr.id, agentId: agent.id, runId: run.id });
    await insertFinding(pg.handle.db, { reviewId: review.id, severity: 'CRITICAL' });
    await insertFinding(pg.handle.db, { reviewId: review.id, severity: 'CRITICAL' });
    await insertFinding(pg.handle.db, { reviewId: review.id, severity: 'WARNING' });

    const res = await app.inject({ method: 'GET', url: `/agents/${agent.id}/stats?range=custom&start=2026-05-01&end=2026-05-01` });
    const body = res.json();
    expect(body.findings_by_severity.CRITICAL).toBe(2);
    expect(body.findings_by_severity.WARNING).toBe(1);
    expect(body.findings_by_severity.SUGGESTION).toBe(0);

    await app.close();
  });

  it('AC-9/D-17: a run with agent_id=NULL (deleted-agent orphan) and a run with status!=done both contribute to NO total, on either endpoint', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = await createAgent(app, 'AC-9 Agent');
    const day = new Date('2026-06-01T00:00:00.000Z');

    await insertRun(pg.handle.db, { workspaceId, agentId: agent.id, prId: pr.id, ranAt: day, costUsd: 1 });
    // Orphaned run (agent deleted) — must not inflate the workspace total.
    await insertRun(pg.handle.db, { workspaceId, agentId: null, prId: pr.id, ranAt: day, costUsd: 99 });
    // Failed run — only status='done' is counted (D-17).
    await insertRun(pg.handle.db, { workspaceId, agentId: agent.id, prId: pr.id, ranAt: day, costUsd: 50, status: 'failed' });

    const statsRes = await app.inject({ method: 'GET', url: `/agents/${agent.id}/stats?range=custom&start=2026-06-01&end=2026-06-01` });
    const stats = statsRes.json();
    expect(stats.runs).toBe(1);
    expect(stats.avg_cost_usd).toBeCloseTo(1, 10);
    expect(stats.total_cost_usd).toBeCloseTo(1, 10);

    const perfRes = await app.inject({ method: 'GET', url: `/agents/performance?range=custom&start=2026-06-01&end=2026-06-01` });
    const perf = perfRes.json();
    // The orphaned run's $99 must not appear anywhere in the workspace total.
    expect(perf.summary.total_cost_usd).toBeCloseTo(1, 10);
    expect(perf.summary.runs).toBe(1);

    await app.close();
  });

  it('NFR-1: an agent belonging to ANOTHER workspace 404s on GET /agents/:id/stats — never returns that agent\'s cost/quality data (IDOR)', async () => {
    const app = await appWith();
    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: 'perf-other-ws' }).returning();
    const [foreignAgent] = await pg.handle.db
      .insert(t.agents)
      .values({ workspaceId: otherWs!.id, name: 'Foreign Agent', provider: 'openai', model: 'gpt-4.1', systemPrompt: 'p' })
      .returning();
    // Give it real spend so a leak would be immediately visible if this test failed.
    await insertRun(pg.handle.db, { workspaceId: otherWs!.id, agentId: foreignAgent!.id, prId: null, costUsd: 999, ranAt: new Date() });

    const res = await app.inject({ method: 'GET', url: `/agents/${foreignAgent!.id}/stats` });
    expect(res.statusCode).toBe(404);
    expect(res.json()).not.toHaveProperty('avg_cost_usd');

    await app.close();
  });

  describe('AC-4/NFR-2: invalid range params 422 BEFORE the handler runs (same shared RangeQuery schema on both endpoints, AC-16)', () => {
    it('start > end 422s on GET /agents/:id/stats', async () => {
      const app = await appWith();
      const agent = await createAgent(app, 'Range Order Agent');
      const res = await app.inject({
        method: 'GET',
        url: `/agents/${agent.id}/stats?range=custom&start=2026-06-10&end=2026-06-01`,
      });
      expect(res.statusCode).toBe(422);
      await app.close();
    });

    it('start > end 422s on GET /agents/performance too', async () => {
      const app = await appWith();
      const res = await app.inject({
        method: 'GET',
        url: '/agents/performance?range=custom&start=2026-06-10&end=2026-06-01',
      });
      expect(res.statusCode).toBe(422);
      await app.close();
    });

    it('a span exceeding 366 days 422s on GET /agents/performance', async () => {
      const app = await appWith();
      const res = await app.inject({
        method: 'GET',
        url: '/agents/performance?range=custom&start=2020-01-01&end=2026-08-01',
      });
      expect(res.statusCode).toBe(422);
      await app.close();
    });

    it('a span exceeding 366 days 422s on GET /agents/:id/stats too', async () => {
      const app = await appWith();
      const agent = await createAgent(app, 'Range Span Agent');
      const res = await app.inject({
        method: 'GET',
        url: `/agents/${agent.id}/stats?range=custom&start=2020-01-01&end=2026-08-01`,
      });
      expect(res.statusCode).toBe(422);
      await app.close();
    });

    it('a valid range does NOT 422 — proves the above are real validation failures, not a broken route', async () => {
      const app = await appWith();
      const agent = await createAgent(app, 'Range Valid Agent');
      const res = await app.inject({
        method: 'GET',
        url: `/agents/${agent.id}/stats?range=custom&start=2026-01-01&end=2026-01-02`,
      });
      expect(res.statusCode).toBe(200);
      await app.close();
    });
  });

  it('AC-38: a full page-load request sequence on BOTH endpoints (default load, switch to 1d, switch to a custom range) makes ZERO calls to any LLM provider or the embedder', async () => {
    const openaiSpy = new MockLLMProvider('openai');
    const anthropicSpy = new MockLLMProvider('anthropic');
    let embedderCalls = 0;
    const embedderSpy = {
      dims: 1536,
      embed: async (texts: string[]) => {
        embedderCalls += 1;
        return texts.map(() => new Array(1536).fill(0));
      },
    };

    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { llm: { openai: openaiSpy, anthropic: anthropicSpy }, embedder: embedderSpy },
    });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = await createAgent(app, 'AC-38 Agent');
    await insertRun(pg.handle.db, { workspaceId, agentId: agent.id, prId: pr.id, ranAt: new Date() });

    // Simulate: page load (server default range), switch to 1d, switch to a
    // custom range — on BOTH the Stats tab's endpoint and the dashboard's.
    await app.inject({ method: 'GET', url: `/agents/${agent.id}/stats` });
    await app.inject({ method: 'GET', url: `/agents/${agent.id}/stats?range=1d` });
    await app.inject({ method: 'GET', url: `/agents/${agent.id}/stats?range=custom&start=2026-01-01&end=2026-12-31` });
    await app.inject({ method: 'GET', url: '/agents/performance' });
    await app.inject({ method: 'GET', url: '/agents/performance?range=1d' });
    await app.inject({ method: 'GET', url: '/agents/performance?range=custom&start=2026-01-01&end=2026-12-31' });

    expect(openaiSpy.calls).toHaveLength(0);
    expect(anthropicSpy.calls).toHaveLength(0);
    expect(embedderCalls).toBe(0);

    await app.close();
  });
});
