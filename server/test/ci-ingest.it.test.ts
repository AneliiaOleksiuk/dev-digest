/**
 * `POST /ci/ingest` — SPEC-05 (`specs/SPEC-05-multi-agent-ci-per-repo.md`)
 * AC-34/AC-35/AC-36, exercised through the REAL route with a real Postgres.
 * SPEC-04's own ingest mechanism (`docs/adr/0010-ci-ingest-bearer-token-hash-lookup.md`)
 * has ZERO prior test coverage — this file is the first, so it covers the
 * SPEC-04 baseline (Bearer-token hash-keyed lookup, repo-equality check,
 * idempotency) that SPEC-05's multi-installation-per-repo behavior sits on
 * top of, per the task's own instruction to cover both where they intersect.
 *
 * Oracle: AC-34 ("a token resolves to exactly one installation, and
 * therefore to exactly one agent, even when several installations share a
 * repository"), AC-35 ("the body's repo-equality check … shall NOT be
 * tightened into an agent check … attribution comes from the authenticated
 * installation, never the body"), AC-36 ("idempotency stays keyed on
 * (installation, actions_run_id) … two agents reviewing one PR produce two
 * distinct Actions run ids under two distinct installations and shall BOTH
 * persist") — derived from the spec text BEFORE reading `service.ts#ingest`'s
 * own implementation beyond its exported signature.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitHubClient } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[ci-ingest] Docker not available — skipping integration tests.');
}

d('POST /ci/ingest — auth, attribution and idempotency across multiple installations on one repo', () => {
  let pg: PgFixture;
  let repoSeq = 0;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({ config, db: pg.handle.db, overrides: { github: new MockGitHubClient() } });
  }

  function freshRepo(): string {
    return `acme/ingest-repo-${repoSeq++}-${Date.now()}`;
  }

  async function createAgent(app: Awaited<ReturnType<typeof buildApp>>, name: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name, provider: 'openai', model: 'gpt-4o-mini', system_prompt: 'Review the diff.' },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id;
  }

  async function install(app: Awaited<ReturnType<typeof buildApp>>, agentId: string, repo: string) {
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: {
        repo,
        target: 'gha',
        post_as: 'github_review',
        triggers: ['opened', 'synchronize', 'reopened'],
        base: 'main',
        ingest_url: 'https://studio.example.com/ci/ingest',
      },
    });
    expect(res.statusCode).toBe(200);
    return res.json();
  }

  function ingestPayload(overrides: Record<string, unknown> = {}) {
    return {
      result: { findings_count: 1, critical: 1, warning: 0, suggestion: 0, cost_usd: 0.01, agent: 'a' },
      repo: 'acme/does-not-matter', // overridden per-test
      head_sha: 'a'.repeat(40),
      pr_number: 42,
      actions_run_id: `run-${Date.now()}-${Math.random()}`,
      job_url: 'https://github.com/acme/repo/actions/runs/1',
      source: 'github_actions',
      status: 'succeeded',
      duration_ms: 1000,
      error: null,
      ...overrides,
    };
  }

  it('SPEC-04 baseline: a missing/absent Authorization header 401s and writes nothing', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/ci/ingest', payload: ingestPayload() });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('SPEC-04 baseline: a well-formed but UNKNOWN token 401s (the hash-keyed lookup itself is the auth)', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/ci/ingest',
      headers: { authorization: 'Bearer not-a-real-token' },
      payload: ingestPayload(),
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('AC-34: a valid token resolves to exactly ONE installation/agent — it cannot write a run attributed to another agent', async () => {
    const app = await makeApp();
    const repo = freshRepo();
    const agentA = await createAgent(app, 'Ingest Agent A');
    const agentB = await createAgent(app, 'Ingest Agent B');
    const installA = await install(app, agentA, repo);
    await install(app, agentB, repo);

    const res = await app.inject({
      method: 'POST',
      url: '/ci/ingest',
      headers: { authorization: `Bearer ${installA.ingest_token}` },
      payload: ingestPayload({ repo }),
    });
    expect(res.statusCode).toBe(201);

    const runs = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.repo, repo));
    expect(runs).toHaveLength(1);
    expect(runs[0]!.agentId).toBe(agentA);
    expect(runs[0]!.agentId).not.toBe(agentB);
    expect(runs[0]!.ciInstallationId).toBe(installA.installation.id);

    await app.close();
  });

  it('AC-35: the repo-equality check stays a REPO check — two installations on one repo both ingest successfully, attributed to their OWN agents', async () => {
    const app = await makeApp();
    const repo = freshRepo();
    const agentA = await createAgent(app, 'Repo Check A');
    const agentB = await createAgent(app, 'Repo Check B');
    const installA = await install(app, agentA, repo);
    const installB = await install(app, agentB, repo);

    const resA = await app.inject({
      method: 'POST',
      url: '/ci/ingest',
      headers: { authorization: `Bearer ${installA.ingest_token}` },
      payload: ingestPayload({ repo, actions_run_id: `run-a-${Date.now()}` }),
    });
    const resB = await app.inject({
      method: 'POST',
      url: '/ci/ingest',
      headers: { authorization: `Bearer ${installB.ingest_token}` },
      payload: ingestPayload({ repo, actions_run_id: `run-b-${Date.now()}` }),
    });
    expect(resA.statusCode).toBe(201);
    expect(resB.statusCode).toBe(201);

    const runs = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.repo, repo));
    expect(runs).toHaveLength(2);
    expect(new Set(runs.map((r) => r.agentId))).toEqual(new Set([agentA, agentB]));

    await app.close();
  });

  it('SPEC-04 baseline: a body whose repo does NOT match the installed repo is rejected', async () => {
    const app = await makeApp();
    const repo = freshRepo();
    const agentId = await createAgent(app, 'Repo Mismatch Agent');
    const installed = await install(app, agentId, repo);

    const res = await app.inject({
      method: 'POST',
      url: '/ci/ingest',
      headers: { authorization: `Bearer ${installed.ingest_token}` },
      payload: ingestPayload({ repo: 'someone-else/unrelated-repo' }),
    });
    expect(res.statusCode).toBe(422);

    await app.close();
  });

  it('AC-36: two agents reviewing the SAME pull request produce two distinct Actions run ids under two distinct installations — BOTH persist, not deduplicated', async () => {
    const app = await makeApp();
    const repo = freshRepo();
    const agentA = await createAgent(app, 'Same PR Agent A');
    const agentB = await createAgent(app, 'Same PR Agent B');
    const installA = await install(app, agentA, repo);
    const installB = await install(app, agentB, repo);

    const samePr = 99;
    await app.inject({
      method: 'POST',
      url: '/ci/ingest',
      headers: { authorization: `Bearer ${installA.ingest_token}` },
      payload: ingestPayload({ repo, pr_number: samePr, actions_run_id: 'run-shared-pr-a' }),
    });
    await app.inject({
      method: 'POST',
      url: '/ci/ingest',
      headers: { authorization: `Bearer ${installB.ingest_token}` },
      payload: ingestPayload({ repo, pr_number: samePr, actions_run_id: 'run-shared-pr-b' }),
    });

    const runs = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.repo, repo));
    expect(runs).toHaveLength(2);

    await app.close();
  });

  it('AC-36/SPEC-04 baseline: idempotency — the SAME (installation, actions_run_id) reported twice persists only ONE row', async () => {
    const app = await makeApp();
    const repo = freshRepo();
    const agentId = await createAgent(app, 'Idempotent Agent');
    const installed = await install(app, agentId, repo);
    const runId = `run-idempotent-${Date.now()}`;

    const first = await app.inject({
      method: 'POST',
      url: '/ci/ingest',
      headers: { authorization: `Bearer ${installed.ingest_token}` },
      payload: ingestPayload({ repo, actions_run_id: runId }),
    });
    const second = await app.inject({
      method: 'POST',
      url: '/ci/ingest',
      headers: { authorization: `Bearer ${installed.ingest_token}` },
      payload: ingestPayload({ repo, actions_run_id: runId }),
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201); // a conflict is a no-op success, never surfaced as an error

    const runs = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(eq(t.agentRuns.ciInstallationId, installed.installation.id));
    expect(runs).toHaveLength(1);

    await app.close();
  });
});
