/**
 * Brief module (SPEC-03) — route + real-Postgres integration tests
 * (Testcontainers, mocked LLM). Same harness shape as
 * `test/onboarding.it.test.ts` / `test/settings-models.it.test.ts`.
 *
 * Oracle: specs/SPEC-03-pr-brief-and-why-timeline.md AC-13, AC-36, AC-38,
 * AC-40 and the Development Plan's Constraints section (AC-38's harness
 * gap — rate limiting is inert under `NODE_ENV=test`, so this file
 * explicitly builds the app with `nodeEnv: 'production'` for that one
 * describe block, per the plan's stated instructions) — derived BEFORE
 * reading `routes.ts`/`repository.drizzle.ts`.
 *
 * `pr_files` is left empty in most fixtures here on purpose: with zero
 * changed files, `BlastService` short-circuits to its `degraded` response
 * WITHOUT touching `repoIntel` at all (`blast/service.ts`'s "not synced yet"
 * branch), and `loadDiff` falls back to `diffFromPrFiles` (empty diff) — so
 * these tests need no `repoIntel`/git override to exercise a real
 * generation end-to-end. Grounding drops every risk/focus item against an
 * empty changed-file set, which is fine: these tests are about routing,
 * tenancy and persistence, not grounding fidelity (that's
 * `brief-grounding.test.ts`'s job).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, and } from 'drizzle-orm';
import type { BriefResponse, BriefTimelineResponse } from '@devdigest/shared';
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
  console.warn('[brief] Docker not available — skipping integration tests.');
}

const testConfig = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
const prodConfig = () =>
  loadConfig({ ...process.env, NODE_ENV: 'production', LOG_LEVEL: 'silent' } as NodeJS.ProcessEnv);

const VALID_FIXTURE = {
  what: 'Adds rate limiting middleware to the public API.',
  why: 'Protects the API from abuse.',
  risk_level: 'medium',
  risks: [],
  review_focus: [],
};

d('Brief module (SPEC-03) — routes + generation (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoSeq = 0;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function makePr(opts: { ws?: string; headSha?: string } = {}) {
    const name = `brief-repo-${repoSeq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: opts.ws ?? workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId: opts.ws ?? workspaceId,
        repoId: repo!.id,
        number: 1,
        title: 'Add rate limiting',
        author: 'marisa.koch',
        branch: 'feat/rl',
        base: 'main',
        headSha: opts.headSha ?? 'sha-current',
        additions: 1,
        deletions: 0,
        filesCount: 0,
        status: 'needs_review',
        body: 'Adds rate limiting.', // no #issue reference, no .md reference
      })
      .returning();
    return { repo: repo!, pr: pr! };
  }

  function appWith(structured: unknown = VALID_FIXTURE) {
    const llm = new MockLLMProvider('openai', { structured });
    return {
      llm,
      appPromise: buildApp({
        config: testConfig(),
        db: pg.handle.db,
        overrides: { llm: { openai: llm, openrouter: llm, anthropic: llm } },
      }),
    };
  }

  // ------------------------------------------------------------- AC-36/A01
  it('AC-36: a PR belonging to workspace A 404s on ALL THREE routes when addressed from workspace B — including the list route (IDOR)', async () => {
    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: 'brief-other-ws' }).returning();
    const { pr } = await makePr({ ws: otherWs!.id });
    const { llm, appPromise } = appWith();
    const app = await appPromise;

    const getRes = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(getRes.statusCode).toBe(404);

    const genRes = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/brief/generate`,
      payload: { head_sha: pr.headSha },
    });
    expect(genRes.statusCode).toBe(404);

    const timelineRes = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief/timeline` });
    expect(timelineRes.statusCode).toBe(404);

    expect(llm.calls).toEqual([]);
    await app.close();
  });

  // ------------------------------------------------------------- Zod 422
  // The plan's WI8 DoD text says "should 400" — but this codebase's uniform
  // validation-error convention (`server/src/app.ts`'s
  // `hasZodFastifySchemaValidationErrors` branch, "Validation → 422")
  // returns 422 for EVERY route, not just this one. Asserting 422 here
  // matches the actual, consistent, already-established convention rather
  // than the plan's imprecise HTTP-code prose — the real requirement (a
  // malformed body is REJECTED, not an unhandled 500) holds either way.
  it('POST .../generate with a malformed body (missing head_sha) is rejected as a validation error (422), not an unhandled throw', async () => {
    const { pr } = await makePr();
    const { appPromise } = appWith();
    const app = await appPromise;

    const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief/generate`, payload: {} });
    expect(res.statusCode).toBe(422);

    await app.close();
  });

  it('POST .../generate with head_sha as a non-string is rejected as a validation error (422)', async () => {
    const { pr } = await makePr();
    const { appPromise } = appWith();
    const app = await appPromise;

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/brief/generate`,
      payload: { head_sha: 12345 },
    });
    expect(res.statusCode).toBe(422);

    await app.close();
  });

  // -------------------------------------------------------------------- AC-13
  it('AC-13: two force regenerations for the same head_sha leave EXACTLY ONE row (onConflictDoUpdate replaces, never appends)', async () => {
    const { pr } = await makePr();
    const { appPromise: firstAppPromise } = appWith({ ...VALID_FIXTURE, what: 'first version' });
    const firstApp = await firstAppPromise;
    const first = await firstApp.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/brief/generate`,
      payload: { head_sha: pr.headSha },
    });
    expect(first.statusCode).toBe(200);
    await firstApp.close();

    const { llm, appPromise: secondAppPromise } = appWith({ ...VALID_FIXTURE, what: 'second version' });
    const secondApp = await secondAppPromise;
    const second = await secondApp.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/brief/generate`,
      payload: { head_sha: pr.headSha, force: true },
    });
    expect(second.statusCode).toBe(200);
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);
    await secondApp.close();

    const rows = await pg.handle.db
      .select()
      .from(t.prBrief)
      .where(and(eq(t.prBrief.prId, pr.id), eq(t.prBrief.headSha, pr.headSha)));
    expect(rows).toHaveLength(1);
    const json = rows[0]!.json as { what: string };
    expect(json.what).toBe('second version');
  });

  // -------------------------------------------------------------------- AC-16
  it('AC-16: generating for a non-current head_sha is refused (409) with zero model calls', async () => {
    const { pr } = await makePr({ headSha: 'sha-current' });
    const { llm, appPromise } = appWith();
    const app = await appPromise;

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/brief/generate`,
      payload: { head_sha: 'sha-not-current' },
    });
    expect(res.statusCode).toBe(409);
    expect(llm.calls).toEqual([]);

    await app.close();
  });

  // -------------------------------------------------------------------- AC-40
  it('AC-40: a hand-corrupted stored pr_brief.json row degrades to "corrupt" on GET rather than crashing', async () => {
    const { pr } = await makePr();
    const { appPromise } = appWith();
    const app = await appPromise;
    const gen = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/brief/generate`,
      payload: { head_sha: pr.headSha },
    });
    expect(gen.statusCode).toBe(200);

    await pg.handle.db
      .update(t.prBrief)
      .set({ json: { totally: 'not a brief shape' } })
      .where(and(eq(t.prBrief.prId, pr.id), eq(t.prBrief.headSha, pr.headSha)));

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as BriefResponse;
    expect(body.state).toBe('corrupt');
    expect(body.record).toBeNull();
    expect(body.reason).toBeTruthy();

    await app.close();
  });

  // ------------------------------------------------------------- AC-10/AC-26
  it('AC-10: persisted usage matches the mock provider\'s returned figures (provider/model/tokens/cost)', async () => {
    const { pr } = await makePr();
    const { appPromise } = appWith();
    const app = await appPromise;

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/brief/generate`,
      payload: { head_sha: pr.headSha },
    });
    const body = res.json() as BriefResponse;
    expect(body.record?.usage).toMatchObject({
      provider: 'openai',
      model: 'gpt-4.1',
      tokens_in: 100,
      tokens_out: 50,
      cost_usd: 0.001,
    });
    expect(body.record?.usage.input_tokens).toBeGreaterThan(0);
    expect(body.record?.head_sha).toBe(pr.headSha);

    await app.close();
  });

  // ------------------------------------------------------------------ AC-14
  it('AC-14: the timeline lists every persisted brief for the PR with zero model calls', async () => {
    const { pr } = await makePr();
    const { appPromise: genAppPromise } = appWith();
    const genApp = await genAppPromise;
    await genApp.inject({ method: 'POST', url: `/pulls/${pr.id}/brief/generate`, payload: { head_sha: pr.headSha } });
    await genApp.close();

    const { llm, appPromise: readAppPromise } = appWith();
    const readApp = await readAppPromise;
    const res = await readApp.inject({ method: 'GET', url: `/pulls/${pr.id}/brief/timeline` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as BriefTimelineResponse;
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]!.is_current_head).toBe(true);
    expect(llm.calls).toEqual([]);

    await readApp.close();
  });
});

// ---------------------------------------------------------------- AC-38
d('Brief module (SPEC-03) — AC-38 rate limiting (nodeEnv: production harness)', () => {
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

  it('AC-38: the 11th generate request within a minute for the same PR is rate-limited (429) at 10/min, matching the other model-spending PR routes', async () => {
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'brief-ratelimit-repo', fullName: 'acme/brief-ratelimit-repo' })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 1,
        title: 'Rate limit target PR',
        author: 'marisa.koch',
        branch: 'feat/x',
        base: 'main',
        headSha: 'sha-rl',
        status: 'needs_review',
        body: 'Body with no references.',
      })
      .returning();

    const llm = new MockLLMProvider('openai', { structured: VALID_FIXTURE });
    const app = await buildApp({
      config: prodConfig(),
      db: pg.handle.db,
      overrides: { llm: { openai: llm, openrouter: llm, anthropic: llm } },
    });

    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      // force:false + an already-cached row after the first call means every
      // request after #1 is a zero-model-call cache hit — the rate limit is
      // still enforced by Fastify BEFORE the handler runs, so this still
      // proves AC-38 without needing 11 distinct LLM calls.
      const res = await app.inject({
        method: 'POST',
        url: `/pulls/${pr!.id}/brief/generate`,
        payload: { head_sha: 'sha-rl' },
      });
      statuses.push(res.statusCode);
    }

    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);

    await app.close();
  }, 20_000);
});
