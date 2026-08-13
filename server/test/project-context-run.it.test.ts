/**
 * Project Context (SPEC-01) WI7 — run-executor integration test (real
 * Postgres, mocked LLM/git). No existing self-check: the implementer's
 * report explicitly deferred the run-executor tests to test-writer.
 *
 * DoD (WI7): ".it.test.ts proving AC-20 (deleted file → run completes, log
 * line names the path), AC-22, AC-26 (one trace entry per injected
 * document, non-null size), AC-28 (failed run's trace has `specs: null` and
 * no project-context claim)."
 *
 * Same harness shape as `test/reviews.it.test.ts`: `buildApp` against a
 * Testcontainers Postgres, `MockGitClient` for the diff, `MockLLMProvider`
 * for the model call, `POST /pulls/:id/review` + `waitForPrRuns` + `GET
 * /runs/:id/trace`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[project-context-run] Docker not available — skipping integration tests.');
}

const DIFF = `diff --git a/api/handler.ts b/api/handler.ts
--- a/api/handler.ts
+++ b/api/handler.ts
@@ -1,2 +1,3 @@
 export function handler() {
+  import('../db');
 }`;

const REVIEW_FIXTURE: Review = {
  verdict: 'approve',
  summary: 'Looks fine.',
  score: 90,
  findings: [],
};

/** ~6600-token document (under `cl100k_base`) once truncated to
 *  `MAX_DOC_CHARS` (20,000 chars) — varied word content so BPE doesn't
 *  compress it into a handful of tokens the way a repeated character would.
 *  Two of these exceed `PROJECT_CONTEXT_TOKEN_BUDGET` (8000); one alone
 *  does not. */
function bigDoc(seed: string): string {
  const words: string[] = [];
  for (let i = 0; i < 6000; i++) words.push(`${seed}${i}x${(i * 7) % 997}`);
  return words.join(' ');
}

d('Project Context run-executor wiring (WI7)', () => {
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

  async function appWith(structured: unknown) {
    const llm = new MockLLMProvider('openai', { structured });
    const app = await buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ diff: DIFF }),
        github: new MockGitHubClient(),
        llm: { openai: llm, openrouter: llm },
      },
    });
    return { app, llm };
  }

  let repoSeq = 0;
  async function setupRepoAndPr(clonePath: string) {
    const name = `wi7-repo-${repoSeq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}`, clonePath })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 7,
        title: 'Import db from api',
        author: 'dev',
        branch: 'feat/x',
        base: 'main',
        headSha: 'deadbeef',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    await pg.handle.db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'api/handler.ts',
      additions: 1,
      deletions: 0,
      patch: "@@ -1,2 +1,3 @@\n export function handler() {\n+  import('../db');\n }",
    });
    return { repo: repo!, pr: pr! };
  }

  async function createAgent(app: Awaited<ReturnType<typeof appWith>>['app']) {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name: 'WI7 agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'Review.' },
    });
    return res.json().id as string;
  }

  async function attach(
    app: Awaited<ReturnType<typeof appWith>>['app'],
    agentId: string,
    repoId: string,
    paths: string[],
  ) {
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/context`,
      payload: { repo_id: repoId, paths },
    });
    expect(res.statusCode).toBe(200);
  }

  async function runAndWait(
    app: Awaited<ReturnType<typeof appWith>>['app'],
    prId: string,
    agentId: string,
  ) {
    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${prId}/review`,
      payload: { agentId },
    });
    const runId = res.json().runs[0].run_id as string;
    await waitForPrRuns(pg.handle.db, prId, { expected: 1 });
    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    const [run] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
    return { runId, trace, run: run! };
  }

  it('AC-20/AC-26: a deleted attached document is skipped with a log line naming its path; the surviving one gets exactly one trace entry with a non-null size', async () => {
    const clonePath = await mkdtemp(join(tmpdir(), 'project-context-run-'));
    await mkdir(join(clonePath, 'docs'), { recursive: true });
    await writeFile(join(clonePath, 'docs', 'rule.md'), 'The api module must not import db directly.');
    // 'docs/gone.md' is attached but never written to disk (E-2/AC-20).

    const { app } = await appWith(REVIEW_FIXTURE);
    const { repo, pr } = await setupRepoAndPr(clonePath);
    const agentId = await createAgent(app);
    await attach(app, agentId, repo.id, ['docs/rule.md', 'docs/gone.md']);

    const { trace, run } = await runAndWait(app, pr.id, agentId);
    expect(run.status).toBe('done');

    // AC-26: exactly one trace entry — for the readable document — with a
    // non-null path/tokens/chars.
    expect(trace.project_context_docs).toHaveLength(1);
    expect(trace.project_context_docs[0]).toMatchObject({ path: 'docs/rule.md' });
    expect(trace.project_context_docs[0].tokens).toBeGreaterThan(0);
    expect(trace.project_context_docs[0].chars).toBeGreaterThan(0);

    // AC-20: the deleted path is named in a run-log line, never in the trace.
    expect(trace.log.some((l: { msg: string }) => l.msg.includes('docs/gone.md'))).toBe(true);
    expect(JSON.stringify(trace.project_context_docs)).not.toContain('docs/gone.md');

    // AC-18/19: the surviving document's path is inside the assembled prompt.
    expect(trace.prompt_assembly.specs).toContain('docs/rule.md');

    await app.close();
    await rm(clonePath, { recursive: true, force: true });
  });

  it('AC-22: the second of two over-budget documents is dropped, named in a log line, and absent from the trace', async () => {
    const clonePath = await mkdtemp(join(tmpdir(), 'project-context-run-budget-'));
    await mkdir(join(clonePath, 'docs'), { recursive: true });
    await writeFile(join(clonePath, 'docs', 'a.md'), bigDoc('alpha'));
    await writeFile(join(clonePath, 'docs', 'b.md'), bigDoc('beta'));

    const { app } = await appWith(REVIEW_FIXTURE);
    const { repo, pr } = await setupRepoAndPr(clonePath);
    const agentId = await createAgent(app);
    // Persisted order: a.md first, b.md second — b.md is the one over budget.
    await attach(app, agentId, repo.id, ['docs/a.md', 'docs/b.md']);

    const { trace, run } = await runAndWait(app, pr.id, agentId);
    expect(run.status).toBe('done');

    expect(trace.project_context_docs.map((d: { path: string }) => d.path)).toEqual(['docs/a.md']);
    expect(trace.log.some((l: { msg: string }) => l.msg.includes('docs/b.md'))).toBe(true);
    expect(trace.prompt_assembly.specs).toContain('docs/a.md');
    expect(trace.prompt_assembly.specs).not.toContain('docs/b.md');

    await app.close();
    await rm(clonePath, { recursive: true, force: true });
  });

  it('AC-28: a failed run never claims a project-context block — specs stays null, project_context_docs stays []', async () => {
    const clonePath = await mkdtemp(join(tmpdir(), 'project-context-run-fail-'));
    await mkdir(join(clonePath, 'docs'), { recursive: true });
    await writeFile(join(clonePath, 'docs', 'rule.md'), 'The api module must not import db directly.');

    // No `structured` fixture ⇒ MockLLMProvider validates `{}` against the
    // Review schema, which fails ⇒ the model call throws ⇒ the run fails,
    // AFTER the project-context set was already resolved and would
    // otherwise have been injected.
    const { app } = await appWith(undefined);
    const { repo, pr } = await setupRepoAndPr(clonePath);
    const agentId = await createAgent(app);
    await attach(app, agentId, repo.id, ['docs/rule.md']);

    const { trace, run } = await runAndWait(app, pr.id, agentId);
    expect(run.status).toBe('failed');
    expect(trace.prompt_assembly.specs).toBeNull();
    expect(trace.project_context_docs).toEqual([]);

    await app.close();
    await rm(clonePath, { recursive: true, force: true });
  });
});
