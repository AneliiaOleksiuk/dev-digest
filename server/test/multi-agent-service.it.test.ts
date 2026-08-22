import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { eq, and, inArray } from 'drizzle-orm';
import type { LLMProvider, StructuredRequest, StructuredResult } from '@devdigest/shared';

/**
 * L07 (SPEC-04) — integration tests for `MultiAgentService` (the batch
 * orchestration service, docs/plans/spec-04-multi-agent-review.md WI5).
 *
 * Oracle derived from specs/SPEC-04-multi-agent-review.md AC-9, AC-10,
 * AC-12, AC-13, E-4, E-5 and NFR-3's IDOR requirement, BEFORE reading
 * `multi-agent-service.ts` in depth.
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
  verdict: 'approve',
  summary: 'Looks fine.',
  score: 90,
  findings: [],
};

const INTENT_FIXTURE = {
  intent: 'Add rate limiting to protect the API from abuse.',
  in_scope: ['rate limiting middleware'],
  out_of_scope: [],
  confidence: 0.8,
  missing_context: [],
  risk_areas: [],
};

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `ma-svc-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 900 + repoSeq,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: `sha-${repoSeq}`,
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

/** Records each `completeStructured` call's [start, end] wall-clock window
 *  and adds an artificial delay so AC-10's overlap assertion is deterministic
 *  instead of racing real (near-instant) mock latency. */
class DelayedLLMProvider implements LLMProvider {
  readonly id: 'openai' = 'openai';
  constructor(
    private delayMs: number,
    private windows: { start: number; end: number }[],
    private fixture: unknown,
  ) {}
  async listModels() {
    return [{ id: 'gpt-4.1', provider: 'openai' as const }];
  }
  async complete() {
    return { text: 'mock', model: 'gpt-4.1', tokensIn: 1, tokensOut: 1, costUsd: 0.001 };
  }
  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const start = Date.now();
    await new Promise((r) => setTimeout(r, this.delayMs));
    const end = Date.now();
    this.windows.push({ start, end });
    const parsed = (req.schema as { parse: (v: unknown) => T }).parse(this.fixture);
    return { data: parsed, model: req.model, tokensIn: 10, tokensOut: 10, costUsd: 0.001, raw: '{}', attempts: 1 };
  }
  async embed(texts: string[]) {
    return texts.map(() => new Array(1536).fill(0));
  }
}

/** A provider whose completeStructured always throws — used to inject a
 *  deterministic single-agent failure (AC-13). */
class FailingLLMProvider implements LLMProvider {
  readonly id: 'anthropic' = 'anthropic';
  async listModels() {
    return [{ id: 'claude-x', provider: 'anthropic' as const }];
  }
  async complete(): Promise<never> {
    throw new Error('mock provider error');
  }
  async completeStructured(): Promise<never> {
    throw new Error('mock provider error: simulated 5xx');
  }
  async embed(texts: string[]) {
    return texts.map(() => new Array(1536).fill(0));
  }
}

async function waitForBatchTerminal(
  db: PgFixture['handle']['db'],
  multiAgentRunId: string,
  expectedCount: number,
  timeoutMs = 10_000,
) {
  const TERMINAL = new Set(['done', 'failed', 'cancelled']);
  const start = Date.now();
  for (;;) {
    const rows = await db.select().from(t.agentRuns).where(eq(t.agentRuns.multiAgentRunId, multiAgentRunId));
    if (rows.length >= expectedCount && rows.every((r) => TERMINAL.has(r.status ?? ''))) return rows;
    if (Date.now() - start > timeoutMs) return rows;
    await new Promise((r) => setTimeout(r, 25));
  }
}

d('MultiAgentService (Testcontainers pg)', () => {
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

  it('AC-9: creates exactly one multi_agent_runs parent + N linked agent_runs children', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const a1 = await createAgent(app, 'A1');
    const a2 = await createAgent(app, 'A2');
    const a3 = await createAgent(app, 'A3');

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/multi-agent-run`,
      payload: { agent_ids: [a1.id, a2.id, a3.id] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.runs).toHaveLength(3);

    const parents = await pg.handle.db
      .select()
      .from(t.multiAgentRuns)
      .where(eq(t.multiAgentRuns.id, body.multi_agent_run_id));
    expect(parents).toHaveLength(1);
    expect(parents[0]!.prId).toBe(pr.id);

    const children = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(eq(t.agentRuns.multiAgentRunId, body.multi_agent_run_id));
    expect(children).toHaveLength(3);
    expect(children.every((c) => c.multiAgentRunId === body.multi_agent_run_id)).toBe(true);
    expect(children.map((c) => c.agentId).sort()).toEqual([a1.id, a2.id, a3.id].sort());

    await waitForBatchTerminal(pg.handle.db, body.multi_agent_run_id, 3);
    await app.close();
  });

  it('AC-12: returns the batch id + child run ids IMMEDIATELY, before any agent completes', async () => {
    const windows: { start: number; end: number }[] = [];
    const app = await appWith({ openai: new DelayedLLMProvider(300, windows, REVIEW_FIXTURE) });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const a1 = await createAgent(app, 'Slow1');
    const a2 = await createAgent(app, 'Slow2');

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/multi-agent-run`,
      payload: { agent_ids: [a1.id, a2.id] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.multi_agent_run_id).toBeTruthy();
    expect(body.runs).toHaveLength(2);

    // Fetch immediately (inject() only resolves after the HANDLER returns,
    // which per AC-12 must be before either 300ms-delayed agent finishes).
    const childrenRightAfter = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(eq(t.agentRuns.multiAgentRunId, body.multi_agent_run_id));
    expect(childrenRightAfter).toHaveLength(2);
    expect(childrenRightAfter.every((c) => c.status === 'running')).toBe(true);

    await waitForBatchTerminal(pg.handle.db, body.multi_agent_run_id, 2);
    await app.close();
  });

  it('AC-10: agents in a batch run CONCURRENTLY — overlapping start/end windows under an artificial per-call delay; run-executor.ts is untouched', async () => {
    const windows: { start: number; end: number }[] = [];
    const app = await appWith({ openai: new DelayedLLMProvider(200, windows, REVIEW_FIXTURE) });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const a1 = await createAgent(app, 'Conc1');
    const a2 = await createAgent(app, 'Conc2');
    const a3 = await createAgent(app, 'Conc3');

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/multi-agent-run`,
      payload: { agent_ids: [a1.id, a2.id, a3.id] },
    });
    const body = res.json();
    await waitForBatchTerminal(pg.handle.db, body.multi_agent_run_id, 3, 15_000);

    expect(windows).toHaveLength(3);
    // A strictly sequential for...await loop would produce NON-overlapping
    // windows (each start >= previous end). Concurrent (MULTI_AGENT_CONCURRENCY
    // = 3) execution means at least one pair's windows overlap.
    const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) =>
      a.start < b.end && b.start < a.end;
    const anyOverlap = windows.some((w1, i) => windows.some((w2, j) => i !== j && overlaps(w1, w2)));
    expect(anyOverlap).toBe(true);

    // Architectural guardrail (D-1/AC-10): this feature must not require or
    // trigger any change to run-executor.ts.
    const diffStat = execSync('git status --porcelain -- src/modules/reviews/run-executor.ts', {
      encoding: 'utf-8',
    });
    expect(diffStat.trim()).toBe('');

    await app.close();
  });

  it("AC-13: one agent's induced failure leaves sibling runs' execution and persisted results untouched", async () => {
    const app = await appWith({ anthropic: new FailingLLMProvider() });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const good1 = await createAgent(app, 'Good1', 'openai');
    const good2 = await createAgent(app, 'Good2', 'openai');
    const bad = await createAgent(app, 'Bad', 'anthropic');

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/multi-agent-run`,
      payload: { agent_ids: [good1.id, good2.id, bad.id] },
    });
    const body = res.json();
    await waitForBatchTerminal(pg.handle.db, body.multi_agent_run_id, 3);

    const children = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(eq(t.agentRuns.multiAgentRunId, body.multi_agent_run_id));
    const byAgent = new Map(children.map((c) => [c.agentId, c]));

    expect(byAgent.get(bad.id)!.status).toBe('failed');
    expect(byAgent.get(bad.id)!.error).toBeTruthy();

    expect(byAgent.get(good1.id)!.status).toBe('done');
    expect(byAgent.get(good2.id)!.status).toBe('done');

    // Siblings' persisted results (reviews) are present and unaffected.
    const goodRunIds = [byAgent.get(good1.id)!.id, byAgent.get(good2.id)!.id];
    const reviews = await pg.handle.db
      .select()
      .from(t.reviews)
      .where(inArray(t.reviews.runId, goodRunIds));
    expect(reviews).toHaveLength(2);

    await app.close();
  });

  it('E-4: a batch with exactly one agent selected still creates a multi_agent_runs parent — no special case', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const solo = await createAgent(app, 'Solo');

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/multi-agent-run`,
      payload: { agent_ids: [solo.id] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.runs).toHaveLength(1);

    const parents = await pg.handle.db
      .select()
      .from(t.multiAgentRuns)
      .where(eq(t.multiAgentRuns.id, body.multi_agent_run_id));
    expect(parents).toHaveLength(1);

    await waitForBatchTerminal(pg.handle.db, body.multi_agent_run_id, 1);
    await app.close();
  });

  it('E-5: an empty agent-id set is rejected (422) — not silently turned into an empty batch', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const before = await pg.handle.db.select().from(t.multiAgentRuns).where(eq(t.multiAgentRuns.prId, pr.id));

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/multi-agent-run`,
      payload: { agent_ids: [] },
    });
    expect(res.statusCode).toBe(422);

    const after = await pg.handle.db.select().from(t.multiAgentRuns).where(eq(t.multiAgentRuns.prId, pr.id));
    expect(after).toHaveLength(before.length);

    await app.close();
  });

  it('IDOR guard: an agent id from another workspace is rejected BEFORE any row is created — zero rows exist afterward', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const legit = await createAgent(app, 'Legit');

    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: 'ma-other-ws' }).returning();
    const [foreignAgent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId: otherWs!.id,
        name: 'Foreign Agent',
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'p',
      })
      .returning();

    const before = await pg.handle.db.select().from(t.multiAgentRuns).where(eq(t.multiAgentRuns.prId, pr.id));

    // Mixed batch: one legitimate id + one foreign id — the whole request
    // must be rejected, not partially honored.
    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/multi-agent-run`,
      payload: { agent_ids: [legit.id, foreignAgent!.id] },
    });
    expect(res.statusCode).toBe(404);

    const afterParents = await pg.handle.db.select().from(t.multiAgentRuns).where(eq(t.multiAgentRuns.prId, pr.id));
    expect(afterParents).toHaveLength(before.length);

    const afterChildren = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(and(eq(t.agentRuns.prId, pr.id), eq(t.agentRuns.agentId, legit.id)));
    expect(afterChildren).toHaveLength(0);

    await app.close();
  });
});
