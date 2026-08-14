/**
 * Onboarding (SPEC-02) — route + service integration tests (Testcontainers
 * Postgres, mocked LLM/git, a stubbed `repoIntel` facade injected via
 * `ContainerOverrides.repoIntel` so no real indexing pipeline needs to run).
 * Same harness shape as `test/project-context.it.test.ts` /
 * `test/project-context-run.it.test.ts`.
 *
 * Oracle: Spec ACs 1,2,4,5,18,19,20,21,23,24,26,27,28,31,36 and their
 * Development Plan work items (WI6, WI8, WI9) — derived from
 * `specs/SPEC-02-onboarding-generator.md` and
 * `docs/plans/spec-02-onboarding-generator.md` BEFORE reading
 * `service.ts`/`repository.drizzle.ts`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { OnboardingTourResponse } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import type { RepoIntel, IndexState } from '../src/modules/repo-intel/types.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[onboarding] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

function indexState(overrides: Partial<IndexState> = {}): IndexState {
  return {
    repoId: 'repo',
    status: 'full',
    filesIndexed: 20,
    filesSkipped: 0,
    durationMs: 5,
    lastIndexedSha: 'sha-1',
    indexerVersion: 2,
    updatedAt: new Date(),
    ...overrides,
  };
}

/** Above-minimum repoIntel stub: ranked files + a critical-path chain — the
 *  facts collector will proceed to the single LLM call rather than skipping. */
function aboveMinimumRepoIntel(overrides: Partial<RepoIntel> = {}): RepoIntel {
  return {
    indexRepo: async () => ({ status: 'full', filesIndexed: 0, filesSkipped: 0, durationMs: 0 }),
    refreshIndex: async () => ({ status: 'full', filesIndexed: 0, filesSkipped: 0, durationMs: 0 }),
    getIndexState: async () => indexState(),
    getBlastRadius: async () => ({ changedSymbols: [], callers: [], impactedEndpoints: [] }),
    getRepoMap: async () => ({ text: 'src/server.ts: fn boot()', tokens: 10, cached: false }),
    getFileRank: async () => [{ path: 'src/server.ts', percentile: 0.9 }],
    getSymbolsInFiles: async () => [],
    getCallerSignatures: async () => [],
    getUnresolvedReferences: async () => [],
    getConventionSamples: async () => [],
    getTopFilesByRank: async () => ['src/server.ts'],
    getCriticalPaths: async () => [['src/server.ts']],
    ...overrides,
  };
}

const VALID_SECTIONS = (['architecture', 'critical_paths', 'run_locally', 'reading_path', 'first_tasks'] as const).map(
  (kind) => ({ kind, title: kind, body: `body for ${kind}`, diagram: null, links: [] }),
);
const VALID_FIXTURE = { sections: VALID_SECTIONS };

d('Onboarding (SPEC-02) routes + generation', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let clonePath: string;
  let repoSeq = 0;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    clonePath = await mkdtemp(join(tmpdir(), 'onboarding-it-'));
    await writeFile(join(clonePath, 'package.json'), JSON.stringify({ scripts: { dev: 'npm run vite' } }));
    await writeFile(join(clonePath, 'README.md'), '# Widgets\n\n```bash\nnpm run vite\n```');
  });
  afterAll(async () => {
    await pg?.stop();
    await rm(clonePath, { recursive: true, force: true });
  });

  async function makeRepo(opts: { clonePath?: string | null; ws?: string } = {}) {
    const name = `onboarding-repo-${repoSeq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId: opts.ws ?? workspaceId,
        owner: 'acme',
        name,
        fullName: `acme/${name}`,
        clonePath: opts.clonePath === undefined ? clonePath : opts.clonePath,
      })
      .returning();
    return repo!;
  }

  function appWith(opts: { structured?: unknown; repoIntel?: RepoIntel; secrets?: { get: () => Promise<undefined> } }) {
    const llm = new MockLLMProvider('openai', { structured: opts.structured });
    return {
      llm,
      appPromise: buildApp({
        config: config(),
        db: pg.handle.db,
        overrides: {
          git: new MockGitClient(),
          github: new MockGitHubClient(),
          llm: { openai: llm, openrouter: llm, anthropic: llm },
          repoIntel: opts.repoIntel ?? aboveMinimumRepoIntel(),
          ...(opts.secrets ? { secrets: opts.secrets } : {}),
        },
      }),
    };
  }

  // -------------------------------------------------------------- AC-31
  it('AC-31: a repo belonging to another workspace 404s on GET and POST before any repo work', async () => {
    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: 'onboarding-other-ws' }).returning();
    const otherRepo = await makeRepo({ ws: otherWs!.id });
    const { llm, appPromise } = appWith({ structured: VALID_FIXTURE });
    const app = await appPromise;

    const getRes = await app.inject({ method: 'GET', url: `/repos/${otherRepo.id}/onboarding` });
    expect(getRes.statusCode).toBe(404);
    const postRes = await app.inject({ method: 'POST', url: `/repos/${otherRepo.id}/onboarding/generate` });
    expect(postRes.statusCode).toBe(404);
    expect(llm.calls).toEqual([]);

    await app.close();
  });

  // ---------------------------------------------------------------- AC-1
  it('AC-1: GET over a persisted tour serves it with ZERO model calls', async () => {
    const repo = await makeRepo();
    const { llm, appPromise } = appWith({ structured: VALID_FIXTURE });
    const app = await appPromise;

    const genRes = await app.inject({ method: 'POST', url: `/repos/${repo.id}/onboarding/generate` });
    expect(genRes.statusCode).toBe(200);
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);

    const getRes = await app.inject({ method: 'GET', url: `/repos/${repo.id}/onboarding` });
    expect(getRes.statusCode).toBe(200);
    // No NEW model call from the read.
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);

    await app.close();
  });

  // ---------------------------------------------------------------- AC-2
  it('AC-2: a generation issues exactly one completeStructured call and zero complete() calls', async () => {
    const repo = await makeRepo();
    const { llm, appPromise } = appWith({ structured: VALID_FIXTURE });
    const app = await appPromise;

    const res = await app.inject({ method: 'POST', url: `/repos/${repo.id}/onboarding/generate` });
    expect(res.statusCode).toBe(200);
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);
    expect(llm.calls.filter((c) => c.method === 'complete')).toHaveLength(0);

    await app.close();
  });

  // ---------------------------------------------------------------- AC-4
  describe('AC-4: a malformed model response is rejected by schema validation BEFORE persistence', () => {
    const shapes: Record<string, unknown> = {
      'omits a section (4 of 5)': {
        sections: VALID_SECTIONS.slice(0, 4),
      },
      'reorders the sections': {
        sections: [VALID_SECTIONS[1], VALID_SECTIONS[0], VALID_SECTIONS[2], VALID_SECTIONS[3], VALID_SECTIONS[4]],
      },
      'duplicates a kind (two architecture, missing first_tasks)': {
        sections: [VALID_SECTIONS[0], VALID_SECTIONS[0], VALID_SECTIONS[1], VALID_SECTIONS[2], VALID_SECTIONS[3]],
      },
      'adds a sixth, unknown-kind section': {
        sections: [...VALID_SECTIONS, { kind: 'routes_and_apis', title: 'x', body: 'x', diagram: null, links: [] }],
      },
    };

    for (const [name, fixture] of Object.entries(shapes)) {
      it(name, async () => {
        const repo = await makeRepo();
        const { appPromise } = appWith({ structured: fixture });
        const app = await appPromise;

        const res = await app.inject({ method: 'POST', url: `/repos/${repo.id}/onboarding/generate` });
        expect(res.statusCode).toBe(200);
        const body = res.json() as OnboardingTourResponse;
        expect(body.status).toBe('llm_failed');

        // Never persisted: a follow-up GET still reads as never_generated.
        const [row] = await pg.handle.db.select().from(t.onboarding).where(eq(t.onboarding.repoId, repo.id));
        expect(row).toBeUndefined();

        await app.close();
      });
    }
  });

  // --------------------------------------------------------------- AC-18
  // FIX-3 (fix plan for the prior plan-verifier Phase 1 FAIL): this test used
  // to fail — `OnboardingService.getTour`'s no-stored-row branch used to
  // hardcode `status: 'never_generated'` instead of calling the same
  // `deriveStatus(indexState, facts)` helper `runGeneration`'s below-minimum
  // branch already uses, so a no-clone repo's very first GET read as a
  // generic "never generated" rather than AC-17's distinct `no_clone` status.
  // `getTour` now calls `deriveStatus` too, falling back to `never_generated`
  // only when the derived status is `ok`/`partial_index` — confirmed green
  // below with NO change to this test's assertions.
  it('AC-18: no local clone renders a skeleton and skips the LLM call entirely — zero model calls', async () => {
    const repo = await makeRepo({ clonePath: null });
    const { llm, appPromise } = appWith({ structured: VALID_FIXTURE });
    const app = await appPromise;

    const getRes = await app.inject({ method: 'GET', url: `/repos/${repo.id}/onboarding` });
    expect(getRes.statusCode).toBe(200);
    expect((getRes.json() as OnboardingTourResponse).status).toBe('no_clone');
    expect((getRes.json() as OnboardingTourResponse).sections.length).toBeGreaterThan(0);

    const postRes = await app.inject({ method: 'POST', url: `/repos/${repo.id}/onboarding/generate` });
    expect(postRes.statusCode).toBe(200);
    expect((postRes.json() as OnboardingTourResponse).status).toBe('no_clone');
    expect(llm.calls).toEqual([]);

    await app.close();
  });

  // ----------------------------------------------------- FIX-3 (AC-17/AC-18)
  it('FIX-3: a repo WITH a clone and a healthy (ok) index, but genuinely never generated, reads as never_generated — not no_clone/not_indexed', async () => {
    const repo = await makeRepo(); // has a clone (beforeAll's clonePath) + the above-minimum stub index
    const { llm, appPromise } = appWith({ structured: VALID_FIXTURE });
    const app = await appPromise;

    const getRes = await app.inject({ method: 'GET', url: `/repos/${repo.id}/onboarding` });
    expect(getRes.statusCode).toBe(200);
    const body = getRes.json() as OnboardingTourResponse;
    expect(body.status).toBe('never_generated');
    expect(body.generated_at).toBeNull();
    expect(llm.calls).toEqual([]);

    await app.close();
  });

  // -------------------------------------------------------------- FIX-4/AC-15
  it("FIX-4: a walk bounded at MAX_INDEXED_FILES (IndexState.bounded: true) derives partial_index EVEN THOUGH IndexState.status is 'full' — a full-status index can still be an alphabetically-truncated slice (E-5)", async () => {
    const repo = await makeRepo();
    const boundedRepoIntel = aboveMinimumRepoIntel({
      getIndexState: async () => indexState({ status: 'full', bounded: true, filesIndexed: 5000 }),
    });
    const { llm, appPromise } = appWith({ structured: VALID_FIXTURE, repoIntel: boundedRepoIntel });
    const app = await appPromise;

    const res = await app.inject({ method: 'POST', url: `/repos/${repo.id}/onboarding/generate` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as OnboardingTourResponse;
    expect(body.status).toBe('partial_index');
    expect(body.reason.toLowerCase()).toContain('partial');
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);

    await app.close();
  });

  // --------------------------------------------------------------- AC-19
  it('AC-19: facts below the minimum (empty clone, no ranked files) skip the LLM call — zero calls, non-empty skeleton', async () => {
    const emptyClone = await mkdtemp(join(tmpdir(), 'onboarding-it-empty-'));
    const repo = await makeRepo({ clonePath: emptyClone });
    const belowMinRepoIntel = aboveMinimumRepoIntel({
      getTopFilesByRank: async () => [],
      getCriticalPaths: async () => [],
      getFileRank: async () => [],
    });
    const { llm, appPromise } = appWith({ structured: VALID_FIXTURE, repoIntel: belowMinRepoIntel });
    const app = await appPromise;

    const res = await app.inject({ method: 'POST', url: `/repos/${repo.id}/onboarding/generate` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as OnboardingTourResponse;
    expect(body.status).toBe('not_indexed');
    expect(body.sections.length).toBeGreaterThan(0);
    expect(llm.calls).toEqual([]);

    await app.close();
    await rm(emptyClone, { recursive: true, force: true });
  });

  // ------------------------------------------------------- AC-20/AC-21/D-13
  it('AC-20/AC-21: a throwing provider fails the generation and leaves NO stored row (first-ever generation)', async () => {
    const repo = await makeRepo();
    const throwingLlm = new MockLLMProvider('openai');
    throwingLlm.completeStructured = async () => {
      throw new Error('simulated provider failure');
    };
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        llm: { openai: throwingLlm, openrouter: throwingLlm, anthropic: throwingLlm },
        repoIntel: aboveMinimumRepoIntel(),
      },
    });

    const res = await app.inject({ method: 'POST', url: `/repos/${repo.id}/onboarding/generate` });
    expect(res.statusCode).toBe(200);
    expect((res.json() as OnboardingTourResponse).status).toBe('llm_failed');
    const [row] = await pg.handle.db.select().from(t.onboarding).where(eq(t.onboarding.repoId, repo.id));
    expect(row).toBeUndefined();

    await app.close();
  });

  it('AC-21 (the marquee sequence): regenerate FAILS after a successful prior generation — the previous json + generated_at survive byte-identical', async () => {
    const repo = await makeRepo();
    const { appPromise: firstAppPromise } = appWith({ structured: VALID_FIXTURE });
    const firstApp = await firstAppPromise;
    const okRes = await firstApp.inject({ method: 'POST', url: `/repos/${repo.id}/onboarding/generate` });
    expect(okRes.statusCode).toBe(200);
    await firstApp.close();

    const [before] = await pg.handle.db.select().from(t.onboarding).where(eq(t.onboarding.repoId, repo.id));
    expect(before).toBeDefined();

    // Regenerate with a schema-invalid response — same failure bucket AC-20
    // groups a post-retry schema failure into.
    const { llm, appPromise: secondAppPromise } = appWith({ structured: { sections: VALID_SECTIONS.slice(0, 4) } });
    const secondApp = await secondAppPromise;
    const failRes = await secondApp.inject({ method: 'POST', url: `/repos/${repo.id}/onboarding/generate` });
    expect(failRes.statusCode).toBe(200);
    expect((failRes.json() as OnboardingTourResponse).status).toBe('llm_failed');
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);

    const [after] = await pg.handle.db.select().from(t.onboarding).where(eq(t.onboarding.repoId, repo.id));
    expect(after!.json).toEqual(before!.json);
    expect(after!.generatedAt.toISOString()).toBe(before!.generatedAt.toISOString());

    // The GET the page renders still serves the untouched prior tour, not
    // the failure — status must NOT be llm_failed on the read path.
    const getRes = await secondApp.inject({ method: 'GET', url: `/repos/${repo.id}/onboarding` });
    expect((getRes.json() as OnboardingTourResponse).status).not.toBe('llm_failed');

    await secondApp.close();
  });

  it('D-13: an unconfigured provider key degrades on the AC-20 path (no separate disabled state) and leaves the prior tour intact', async () => {
    const repo = await makeRepo();
    const { appPromise: firstAppPromise } = appWith({ structured: VALID_FIXTURE });
    const firstApp = await firstAppPromise;
    await firstApp.inject({ method: 'POST', url: `/repos/${repo.id}/onboarding/generate` });
    await firstApp.close();
    const [before] = await pg.handle.db.select().from(t.onboarding).where(eq(t.onboarding.repoId, repo.id));

    // No `llm` override at all + secrets that return undefined for every key
    // ⇒ container.llm(provider) throws ConfigError ⇒ funnels through the
    // SAME catch as a throwing provider (D-13).
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        repoIntel: aboveMinimumRepoIntel(),
        secrets: { get: async () => undefined },
      },
    });

    const res = await app.inject({ method: 'POST', url: `/repos/${repo.id}/onboarding/generate` });
    expect(res.statusCode).toBe(200);
    expect((res.json() as OnboardingTourResponse).status).toBe('llm_failed');

    const [after] = await pg.handle.db.select().from(t.onboarding).where(eq(t.onboarding.repoId, repo.id));
    expect(after!.json).toEqual(before!.json);

    await app.close();
  });

  // ---------------------------------------------------------------- AC-23
  it('AC-23: a second successful generation REPLACES the row rather than appending — one row per repo', async () => {
    const repo = await makeRepo();
    const { appPromise: firstAppPromise } = appWith({
      structured: { sections: VALID_SECTIONS.map((s) => (s.kind === 'architecture' ? { ...s, body: 'v1' } : s)) },
    });
    const firstApp = await firstAppPromise;
    await firstApp.inject({ method: 'POST', url: `/repos/${repo.id}/onboarding/generate` });
    await firstApp.close();

    const { appPromise: secondAppPromise } = appWith({
      structured: { sections: VALID_SECTIONS.map((s) => (s.kind === 'architecture' ? { ...s, body: 'v2' } : s)) },
    });
    const secondApp = await secondAppPromise;
    await secondApp.inject({ method: 'POST', url: `/repos/${repo.id}/onboarding/generate` });
    await secondApp.close();

    const rows = await pg.handle.db.select().from(t.onboarding).where(eq(t.onboarding.repoId, repo.id));
    expect(rows).toHaveLength(1);
    const json = rows[0]!.json as { sections: { kind: string; body: string }[] };
    expect(json.sections.find((s) => s.kind === 'architecture')!.body).toBe('v2');
  });

  // ---------------------------------------------------------------- AC-24
  it('AC-24: Regenerate never calls git.sync — the current index is used, never a fetch/re-index', async () => {
    const repo = await makeRepo();
    const git = new MockGitClient();
    const llm = new MockLLMProvider('openai', { structured: VALID_FIXTURE });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        git,
        github: new MockGitHubClient(),
        llm: { openai: llm, openrouter: llm, anthropic: llm },
        repoIntel: aboveMinimumRepoIntel(),
      },
    });

    await app.inject({ method: 'POST', url: `/repos/${repo.id}/onboarding/generate` });
    expect(git.syncs).toEqual([]);

    await app.close();
  });

  // ---------------------------------------------------------------- AC-26
  it('AC-26: an index-sha move is reported as stale on a subsequent GET, with no model call', async () => {
    const repo = await makeRepo();
    let currentSha = 'sha-1';
    const movingRepoIntel = aboveMinimumRepoIntel({ getIndexState: async () => indexState({ lastIndexedSha: currentSha }) });
    const { llm, appPromise } = appWith({ structured: VALID_FIXTURE, repoIntel: movingRepoIntel });
    const app = await appPromise;

    const genRes = await app.inject({ method: 'POST', url: `/repos/${repo.id}/onboarding/generate` });
    expect((genRes.json() as OnboardingTourResponse).stale).toBe(false);

    currentSha = 'sha-2'; // the index moved (a resync happened elsewhere)
    const callsBeforeGet = llm.calls.length;
    const getRes = await app.inject({ method: 'GET', url: `/repos/${repo.id}/onboarding` });
    expect((getRes.json() as OnboardingTourResponse).stale).toBe(true);
    expect(llm.calls.length).toBe(callsBeforeGet); // GET never calls the model

    await app.close();
  });

  // ---------------------------------------------------------------- AC-27
  it('AC-27: two concurrent generation requests for the same repo produce exactly ONE completeStructured call', async () => {
    const repo = await makeRepo();
    const { llm, appPromise } = appWith({ structured: VALID_FIXTURE });
    const app = await appPromise;

    // A near-instant mock can let request 1 finish (and clear the in-flight
    // guard) before request 2's dispatch even reaches the route handler —
    // that would prove nothing about the AC-27 guard. Delay the model call
    // so both requests are provably in flight together, the actual race the
    // guard exists for.
    const baseComplete = llm.completeStructured.bind(llm);
    llm.completeStructured = async (req) => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return baseComplete(req);
    };

    const [r1, r2] = await Promise.all([
      app.inject({ method: 'POST', url: `/repos/${repo.id}/onboarding/generate` }),
      app.inject({ method: 'POST', url: `/repos/${repo.id}/onboarding/generate` }),
    ]);
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);

    await app.close();
  });

  // ---------------------------------------------------------------- AC-28
  it('AC-28: persisted usage matches the mock provider returned figures — provider/model/tokens/cost/call_count', async () => {
    const repo = await makeRepo();
    const { appPromise } = appWith({ structured: VALID_FIXTURE });
    const app = await appPromise;

    const res = await app.inject({ method: 'POST', url: `/repos/${repo.id}/onboarding/generate` });
    const body = res.json() as OnboardingTourResponse;
    expect(body.usage).toMatchObject({
      provider: 'openrouter',
      call_count: 1,
      tokens_in: 100,
      tokens_out: 50,
      cost_usd: 0.001,
    });

    await app.close();
  });

  // ------------------------------------------------------------------ AC-5
  it('AC-5: an explicit workspace override for the onboarding feature model is honoured over the registry default', async () => {
    const repo = await makeRepo();
    const { appPromise } = appWith({ structured: VALID_FIXTURE });
    const app = await appPromise;

    const put = await app.inject({
      method: 'PUT',
      url: '/settings',
      payload: { feature_models: { onboarding: { provider: 'anthropic', model: 'claude-override' } } },
    });
    expect(put.statusCode).toBe(200);

    const res = await app.inject({ method: 'POST', url: `/repos/${repo.id}/onboarding/generate` });
    const body = res.json() as OnboardingTourResponse;
    expect(body.usage?.provider).toBe('anthropic');
    expect(body.usage?.model).toBe('claude-override');

    await app.close();
  });

  // ---------------------------------------------------------------- AC-36
  it('AC-36: a hand-corrupted stored onboarding.json row degrades gracefully on GET instead of crashing', async () => {
    const repo = await makeRepo();
    const { appPromise } = appWith({ structured: VALID_FIXTURE });
    const app = await appPromise;
    await app.inject({ method: 'POST', url: `/repos/${repo.id}/onboarding/generate` });

    // Corrupt the stored json — a schema-drifted / earlier-contract row.
    await pg.handle.db
      .update(t.onboarding)
      .set({ json: { sections: 'not-an-array' } })
      .where(eq(t.onboarding.repoId, repo.id));

    const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/onboarding` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as OnboardingTourResponse;
    expect(body.sections).toEqual([]);
    expect(body.reason.length).toBeGreaterThan(0);

    await app.close();
  });
});
