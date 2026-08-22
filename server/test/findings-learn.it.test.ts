import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import type { Embedder, Review } from '@devdigest/shared';

/**
 * L07 (SPEC-04) — integration tests for the `Learn → memory`
 * (`findings.ts`'s `learn` action) and `Turn into eval case`
 * (`eval-case.ts`) service logic
 * (docs/plans/spec-04-multi-agent-review.md WI8).
 *
 * Oracle derived from specs/SPEC-04-multi-agent-review.md AC-36..AC-40,
 * AC-42, AC-44 and NFR-7's ownership check, BEFORE reading `findings.ts`'s
 * learn path / `eval-case.ts` in depth.
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

const REVIEW_FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'Hardcoded Stripe secret introduced.',
  score: 42,
  findings: [
    {
      id: 'f-valid',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A live Stripe key is committed in source.',
      suggestion: 'Move the key to an environment variable.',
      confidence: 0.95,
      kind: 'finding',
    },
  ],
};

/** Spy embedder — AC-38 requires Learn to call the embedder ZERO times.
 *  Wraps a working embed() so a false-negative (a code path that DID call
 *  it and got a real result) can't hide as a thrown error. */
class SpyEmbedder implements Embedder {
  readonly dims = 1536;
  public calls: string[][] = [];
  async embed(texts: string[]): Promise<number[][]> {
    this.calls.push(texts);
    return texts.map(() => new Array(1536).fill(0));
  }
}

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `learn-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 3000 + repoSeq,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: `sha-l-${repoSeq}`,
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

/**
 * Insert a finding directly into a FOREIGN workspace (bypassing every HTTP
 * route, which always resolve to the caller's own default workspace via
 * `LocalNoAuthProvider` — so the only way to plant a resource that genuinely
 * belongs to a DIFFERENT workspace is a direct DB insert, same pattern as
 * `test/agents-versions.it.test.ts`'s `otherWs` fixture).
 */
async function insertForeignFinding(db: PgFixture['handle']['db'], foreignWorkspaceId: string) {
  const { pr } = await setupRepoAndPr(db, foreignWorkspaceId);
  const [review] = await db
    .insert(t.reviews)
    .values({
      workspaceId: foreignWorkspaceId,
      prId: pr.id,
      kind: 'review',
      verdict: 'request_changes',
      summary: 'Foreign workspace review.',
      score: 50,
      model: 'gpt-4.1',
    })
    .returning();
  const [finding] = await db
    .insert(t.findings)
    .values({
      reviewId: review!.id,
      file: 'src/other.ts',
      startLine: 5,
      endLine: 5,
      severity: 'WARNING',
      category: 'bug',
      title: 'Foreign finding',
      rationale: 'belongs to another workspace',
      confidence: 0.5,
    })
    .returning();
  return finding!.id as string;
}

d('Learn → memory / Turn into eval case (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let embedder: SpyEmbedder;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function appWith() {
    embedder = new SpyEmbedder();
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder,
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }) },
      },
    });
  }

  /** Runs a real single-agent review to completion and returns its one finding id. */
  async function makeFinding(app: Awaited<ReturnType<typeof appWith>>, workspaceIdForPr = workspaceId) {
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceIdForPr);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'LearnAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'p' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })).json();
    return { pr, findingId: reviews[0].findings[0].id as string };
  }

  it('AC-36/AC-37: learning a finding creates one memory row (kind=learning, scope=repo, sources naming PR+file:line+agent) and returns memoryId', async () => {
    const app = await appWith();
    const { pr, findingId } = await makeFinding(app);

    const res = await app.inject({ method: 'POST', url: `/findings/${findingId}/learn` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.memory_id).toBeTruthy();

    const [row] = await pg.handle.db.select().from(t.memory).where(eq(t.memory.id, body.memory_id));
    expect(row).toBeTruthy();
    expect(row!.kind).toBe('learning');
    expect(row!.scope).toBe('repo');
    expect(row!.repoId).toBe(pr.repoId);
    expect(row!.content).toContain('Hardcoded Stripe secret key');
    expect(row!.confidence).toBeCloseTo(0.95, 5);
    const sources = row!.sources as { pr: number; context: string }[];
    expect(sources).toHaveLength(1);
    expect(sources[0]!.pr).toBe(pr.number);
    expect(sources[0]!.context).toContain('src/config.ts:11');
    expect(sources[0]!.context).toContain('LearnAgent');

    await app.close();
  });

  it('AC-38: Learn NEVER calls the embedder, and the persisted row\'s embedding is null', async () => {
    const app = await appWith();
    const { findingId } = await makeFinding(app);

    const res = await app.inject({ method: 'POST', url: `/findings/${findingId}/learn` });
    const memoryId = res.json().memory_id;

    expect(embedder.calls).toHaveLength(0);

    const [row] = await pg.handle.db.select().from(t.memory).where(eq(t.memory.id, memoryId));
    expect(row!.embedding).toBeNull();

    await app.close();
  });

  it('AC-39: learning the same finding twice (sequential) returns the SAME memoryId and leaves exactly one row', async () => {
    const app = await appWith();
    const { findingId } = await makeFinding(app);

    const first = (await app.inject({ method: 'POST', url: `/findings/${findingId}/learn` })).json();
    const second = (await app.inject({ method: 'POST', url: `/findings/${findingId}/learn` })).json();
    expect(second.memory_id).toBe(first.memory_id);

    const rows = await pg.handle.db.select().from(t.memory).where(eq(t.memory.learnedFindingId, findingId));
    expect(rows).toHaveLength(1);

    await app.close();
  });

  it('AC-39 (concurrent race): two genuinely concurrent Learn calls on the same finding still leave exactly one row, both resolving to the same memoryId — exercises the unique-violation catch-and-refetch path in insertMemory', async () => {
    const app = await appWith();
    const { findingId } = await makeFinding(app);

    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url: `/findings/${findingId}/learn` }),
      app.inject({ method: 'POST', url: `/findings/${findingId}/learn` }),
    ]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(a.json().memory_id).toBe(b.json().memory_id);

    const rows = await pg.handle.db.select().from(t.memory).where(eq(t.memory.learnedFindingId, findingId));
    expect(rows).toHaveLength(1);

    await app.close();
  });

  it('AC-40: Learn is additive — it does not set accepted_at/dismissed_at, and the finding can still be accepted afterward', async () => {
    const app = await appWith();
    const { findingId } = await makeFinding(app);

    await app.inject({ method: 'POST', url: `/findings/${findingId}/learn` });

    const [findingRow] = await pg.handle.db.select().from(t.findings).where(eq(t.findings.id, findingId));
    expect(findingRow!.acceptedAt).toBeNull();
    expect(findingRow!.dismissedAt).toBeNull();

    const accepted = (await app.inject({ method: 'POST', url: `/findings/${findingId}/accept` })).json();
    expect(accepted.finding.accepted_at).not.toBeNull();

    await app.close();
  });

  it("ownership guard: learning a finding from ANOTHER workspace's PR is rejected (404) and creates no memory row", async () => {
    const app = await appWith();
    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: 'learn-other-ws' }).returning();
    const findingId = await insertForeignFinding(pg.handle.db, otherWs!.id);

    const before = await pg.handle.db.select().from(t.memory).where(eq(t.memory.learnedFindingId, findingId));
    const res = await app.inject({ method: 'POST', url: `/findings/${findingId}/learn` });
    expect(res.statusCode).toBe(404);
    const after = await pg.handle.db.select().from(t.memory).where(eq(t.memory.learnedFindingId, findingId));
    expect(after).toHaveLength(before.length);

    await app.close();
  });

  it('AC-42: turning a finding into an eval case creates one eval_cases row (ownerKind=finding, ownerId=finding id) with the finding\'s own severity/category/file/line/suggestion as expectedOutput', async () => {
    const app = await appWith();
    const { findingId } = await makeFinding(app);

    const res = await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.eval_case_id).toBeTruthy();

    const [row] = await pg.handle.db.select().from(t.evalCases).where(eq(t.evalCases.id, body.eval_case_id));
    expect(row!.ownerKind).toBe('finding');
    expect(row!.ownerId).toBe(findingId);
    expect(row!.name).toContain('Hardcoded Stripe secret key');
    const expected = row!.expectedOutput as { severity: string; category: string; file: string; start_line: number };
    expect(expected.severity).toBe('CRITICAL');
    expect(expected.category).toBe('security');
    expect(expected.file).toBe('src/config.ts');
    expect(expected.start_line).toBe(11);

    await app.close();
  });

  it('AC-44: turning the same finding into an eval case twice (sequential) returns the SAME existing case, not a duplicate', async () => {
    const app = await appWith();
    const { findingId } = await makeFinding(app);

    const first = (await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` })).json();
    const second = (await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` })).json();
    expect(second.eval_case_id).toBe(first.eval_case_id);

    const rows = await pg.handle.db
      .select()
      .from(t.evalCases)
      .where(eq(t.evalCases.ownerId, findingId));
    expect(rows).toHaveLength(1);

    await app.close();
  });

  it('AC-44 (concurrent race): two genuinely concurrent "turn into eval case" calls leave exactly one row — exercises insertEvalCase\'s unique-violation catch-and-refetch path', async () => {
    const app = await appWith();
    const { findingId } = await makeFinding(app);

    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` }),
      app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` }),
    ]);
    expect(a.json().eval_case_id).toBe(b.json().eval_case_id);

    const rows = await pg.handle.db.select().from(t.evalCases).where(eq(t.evalCases.ownerId, findingId));
    expect(rows).toHaveLength(1);

    await app.close();
  });

  it("ownership guard: turning a finding from ANOTHER workspace's PR into an eval case is rejected (404) and creates no row", async () => {
    const app = await appWith();
    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: 'eval-other-ws' }).returning();
    const findingId = await insertForeignFinding(pg.handle.db, otherWs!.id);

    const res = await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    expect(res.statusCode).toBe(404);
    const rows = await pg.handle.db.select().from(t.evalCases).where(eq(t.evalCases.ownerId, findingId));
    expect(rows).toHaveLength(0);

    await app.close();
  });
});
