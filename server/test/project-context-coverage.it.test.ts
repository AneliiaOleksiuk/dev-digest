/**
 * Project Context (SPEC-01 amendment) — AC-30: a document attached ONLY
 * through a disabled skill must NOT count toward `used_by_agents`, which
 * both AC-8's "Used by N agents" display and the client's coverage
 * numerator (AC-29, `computeCoverage`) read directly from. This is a real
 * gap in the existing suite: no test anywhere exercises
 * `usageCountsByPath`'s enabled-only SQL against a real DB — the baseline
 * `project-context.it.test.ts` covers attach round-trips, and
 * `DrizzleContextRepository`'s `listForAgentEffective` enabled-only rule
 * (AC-14/AC-15, INJECTION), but never the LISTING's `used_by_agents` count
 * that AC-30/coverage specifically depend on.
 *
 * Oracle (derived from the Spec/Plan before `repository.drizzle.ts` was
 * read for wiring facts): AC-30, E-7 ("the token totals, 'Used by N
 * agents' and coverage must all apply the same enabled-only rule").
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[project-context-coverage] Docker not available — skipping integration tests.');
}

d('Project Context — AC-30 (disabled-skill-only attachment contributes zero used_by_agents)', () => {
  let pg: PgFixture;
  let clonePath: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    clonePath = await mkdtemp(join(tmpdir(), 'project-context-coverage-it-'));
    await mkdir(join(clonePath, 'docs'), { recursive: true });
    await writeFile(join(clonePath, 'docs', 'rule.md'), '# Rule\ndo not do the thing');
  });
  afterAll(async () => {
    await pg?.stop();
    await rm(clonePath, { recursive: true, force: true });
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  }

  async function getSeededRepoId(): Promise<string> {
    const [repo] = await pg.handle.db
      .select({ id: t.repos.id })
      .from(t.repos)
      .where(eq(t.repos.fullName, 'acme/payments-api'));
    return repo!.id;
  }

  it('AC-30: a document attached ONLY to a disabled skill has used_by_agents: 0 in the listing', async () => {
    const app = await makeApp();
    const repoId = await getSeededRepoId();
    await pg.handle.db.update(t.repos).set({ clonePath }).where(eq(t.repos.id, repoId));

    // A disabled skill, linked to an agent, with the document attached.
    const skillRes = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: {
        name: 'Disabled skill (AC-30)',
        description: 'd',
        type: 'custom',
        source: 'manual',
        body: 'b',
        enabled: false,
      },
    });
    expect(skillRes.statusCode).toBe(201);
    const skillId = skillRes.json().id as string;

    const attachRes = await app.inject({
      method: 'POST',
      url: `/skills/${skillId}/context`,
      payload: { repo_id: repoId, paths: ['docs/rule.md'] },
    });
    expect(attachRes.statusCode).toBe(200);

    const agentRes = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: 'Agent with disabled skill (AC-30)',
        provider: 'openai',
        model: 'gpt-4o-mini',
        system_prompt: 'Review.',
      },
    });
    const agentId = agentRes.json().id as string;
    const linkRes = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/skills`,
      payload: { skill_ids: [skillId] },
    });
    expect(linkRes.statusCode).toBe(200);

    const listingRes = await app.inject({ method: 'GET', url: `/repos/${repoId}/context` });
    expect(listingRes.statusCode).toBe(200);
    const doc = listingRes.json().documents.find((x: { path: string }) => x.path === 'docs/rule.md');
    expect(doc).toBeDefined();
    expect(doc.used_by_agents).toBe(0);

    await app.close();
  });

  it('AC-8 contrast: the SAME document attached to an ENABLED skill DOES count (proves the zero above is the enabled-only rule, not a broken query)', async () => {
    const app = await makeApp();
    const repoId = await getSeededRepoId();
    await pg.handle.db.update(t.repos).set({ clonePath }).where(eq(t.repos.id, repoId));

    const skillRes = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: {
        name: 'Enabled skill (AC-30 contrast)',
        description: 'd',
        type: 'custom',
        source: 'manual',
        body: 'b',
        enabled: true,
      },
    });
    const skillId = skillRes.json().id as string;
    await app.inject({
      method: 'POST',
      url: `/skills/${skillId}/context`,
      payload: { repo_id: repoId, paths: ['docs/rule.md'] },
    });

    const agentRes = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: 'Agent with enabled skill (AC-30 contrast)',
        provider: 'openai',
        model: 'gpt-4o-mini',
        system_prompt: 'Review.',
      },
    });
    const agentId = agentRes.json().id as string;
    await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/skills`,
      payload: { skill_ids: [skillId] },
    });

    const listingRes = await app.inject({ method: 'GET', url: `/repos/${repoId}/context` });
    const doc = listingRes.json().documents.find((x: { path: string }) => x.path === 'docs/rule.md');
    expect(doc.used_by_agents).toBeGreaterThanOrEqual(1);

    await app.close();
  });
});
