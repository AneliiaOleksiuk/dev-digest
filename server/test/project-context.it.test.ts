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
import { DrizzleContextRepository } from '../src/modules/project-context/repository.drizzle.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[project-context] Docker not available — skipping integration tests.');
}

/**
 * Project Context (SPEC-01) — WI6 route self-check (implementer's own
 * verification; test-writer owns the full suite per the work item's stated
 * Definition of done). Covers: AC-1 (nested discovery), AC-3 (no-clone
 * degrade), AC-9/AC-10 (skill/agent round trip, agent_skills untouched),
 * AC-16 (path escape rejected, nothing persisted), and a cross-workspace 404.
 */
d('Project Context routes', () => {
  let pg: PgFixture;
  let clonePath: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    clonePath = await mkdtemp(join(tmpdir(), 'project-context-it-'));
    await mkdir(join(clonePath, 'docs', 'adr'), { recursive: true });
    await writeFile(join(clonePath, 'docs', 'adr', '0001-x.md'), '# ADR 0001\nRule text.');
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

  it('AC-3: a repo with no local clone degrades to an empty listing, not an error', async () => {
    const app = await makeApp();
    const repoId = await getSeededRepoId();
    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/context` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.documents).toEqual([]);
    expect(body.degraded_reason).toBeTypeOf('string');
    await app.close();
  });

  it('AC-1: finds a nested .md document once the repo has a local clone', async () => {
    const app = await makeApp();
    const repoId = await getSeededRepoId();
    await pg.handle.db.update(t.repos).set({ clonePath }).where(eq(t.repos.id, repoId));

    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/context` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.degraded_reason).toBeNull();
    expect(body.documents).toHaveLength(1);
    expect(body.documents[0]).toMatchObject({ path: 'docs/adr/0001-x.md', source_folder: 'docs' });
    await app.close();
  });

  it('AC-9 / AC-10: attach round-trips on a skill and independently on an agent (agent_skills untouched)', async () => {
    const app = await makeApp();
    const repoId = await getSeededRepoId();
    await pg.handle.db.update(t.repos).set({ clonePath }).where(eq(t.repos.id, repoId));

    const skillRes = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: {
        name: 'Test skill',
        description: 'd',
        type: 'custom',
        source: 'manual',
        body: 'body',
      },
    });
    expect(skillRes.statusCode).toBe(201);
    const skillId = skillRes.json().id as string;

    const attachRes = await app.inject({
      method: 'POST',
      url: `/skills/${skillId}/context`,
      payload: { repo_id: repoId, paths: ['docs/adr/0001-x.md'] },
    });
    expect(attachRes.statusCode).toBe(200);
    expect(attachRes.json().documents).toEqual([{ path: 'docs/adr/0001-x.md', order: 0 }]);

    const readRes = await app.inject({
      method: 'GET',
      url: `/skills/${skillId}/context?repo_id=${repoId}`,
    });
    expect(readRes.json().documents).toEqual([{ path: 'docs/adr/0001-x.md', order: 0 }]);

    const agentRes = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: 'Test agent',
        provider: 'openai',
        model: 'gpt-4o-mini',
        system_prompt: 'Review.',
      },
    });
    expect(agentRes.statusCode).toBe(201);
    const agentId = agentRes.json().id as string;

    const agentAttachRes = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/context`,
      payload: { repo_id: repoId, paths: ['docs/adr/0001-x.md'] },
    });
    expect(agentAttachRes.statusCode).toBe(200);

    // Agent's linked skills are untouched by attaching project context.
    const skillsRes = await app.inject({ method: 'GET', url: `/agents/${agentId}/skills` });
    expect(skillsRes.json()).toEqual([]);

    await app.close();
  });

  it('AC-16: a path escaping the clone is rejected 4xx and persists nothing', async () => {
    const app = await makeApp();
    const repoId = await getSeededRepoId();
    await pg.handle.db.update(t.repos).set({ clonePath }).where(eq(t.repos.id, repoId));

    const skillRes = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: { name: 'Escape skill', description: 'd', type: 'custom', source: 'manual', body: 'b' },
    });
    const skillId = skillRes.json().id as string;

    const res = await app.inject({
      method: 'POST',
      url: `/skills/${skillId}/context`,
      payload: { repo_id: repoId, paths: ['../../etc/passwd'] },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);

    const readRes = await app.inject({
      method: 'GET',
      url: `/skills/${skillId}/context?repo_id=${repoId}`,
    });
    expect(readRes.json().documents).toEqual([]);

    await app.close();
  });

  it('cross-workspace: a skill id from another workspace 404s, not 200-with-empty', async () => {
    const app = await makeApp();
    const repoId = await getSeededRepoId();
    // A syntactically valid uuid that was never inserted — same effect as
    // "belongs to a different workspace" from this workspace's point of view.
    const foreignId = '00000000-0000-0000-0000-000000000000';
    const res = await app.inject({
      method: 'GET',
      url: `/skills/${foreignId}/context?repo_id=${repoId}`,
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  // ---- WI4 — DrizzleContextRepository, exercised directly (no HTTP layer) --
  // The implementer's self-check above only proves WI6's routes; WI4's own
  // Definition of done ("replace-set persists order; a second workspace's
  // ids return nothing; the effective query excludes a disabled skill's
  // documents and includes an enabled one's") is about the repository/port,
  // so it's asserted here against `pg.handle.db` directly — same pattern as
  // `agents-versions.it.test.ts`'s "versions are workspace-scoped" test.
  describe('DrizzleContextRepository (WI4)', () => {
    async function defaultWorkspaceId(): Promise<string> {
      const [ws] = await pg.handle.db.select({ id: t.workspaces.id }).from(t.workspaces);
      return ws!.id;
    }

    it('replaceFor persists the array order, and listFor reads it back in that order', async () => {
      const { db } = pg.handle;
      const repo = new DrizzleContextRepository(db);
      const workspaceId = await defaultWorkspaceId();
      const repoId = await getSeededRepoId();
      const [skill] = await db
        .insert(t.skills)
        .values({
          workspaceId,
          name: 'Order skill',
          description: 'd',
          type: 'custom',
          source: 'manual',
          body: 'b',
        })
        .returning();

      const written = await repo.replaceFor(workspaceId, 'skill', skill!.id, repoId, [
        'docs/b.md',
        'docs/a.md',
        'docs/c.md',
      ]);
      expect(written).toEqual([
        { path: 'docs/b.md', order: 0 },
        { path: 'docs/a.md', order: 1 },
        { path: 'docs/c.md', order: 2 },
      ]);

      const read = await repo.listFor(workspaceId, 'skill', skill!.id, repoId);
      expect(read).toEqual(written);

      // Re-replace with a different order — the whole set is replaced, not merged.
      const reordered = await repo.replaceFor(workspaceId, 'skill', skill!.id, repoId, [
        'docs/c.md',
        'docs/a.md',
      ]);
      expect(reordered).toEqual([
        { path: 'docs/c.md', order: 0 },
        { path: 'docs/a.md', order: 1 },
      ]);
      expect(await repo.listFor(workspaceId, 'skill', skill!.id, repoId)).toEqual(reordered);
    });

    it("a second workspace's ids return nothing — even a skill id that DOES exist, just in the other workspace (A01)", async () => {
      const { db } = pg.handle;
      const repo = new DrizzleContextRepository(db);
      const workspaceId = await defaultWorkspaceId();
      const repoId = await getSeededRepoId();
      const [skill] = await db
        .insert(t.skills)
        .values({
          workspaceId,
          name: 'Tenant-scoped skill',
          description: 'd',
          type: 'custom',
          source: 'manual',
          body: 'b',
        })
        .returning();
      await repo.replaceFor(workspaceId, 'skill', skill!.id, repoId, ['docs/secret.md']);

      const [otherWs] = await db.insert(t.workspaces).values({ name: 'other-tenant' }).returning();

      // Same skill id, wrong workspace — must read as empty, never leak the
      // first workspace's rows.
      expect(await repo.listFor(otherWs!.id, 'skill', skill!.id, repoId)).toEqual([]);
      // The original workspace's rows are unaffected.
      expect(await repo.listFor(workspaceId, 'skill', skill!.id, repoId)).toEqual([
        { path: 'docs/secret.md', order: 0 },
      ]);
    });

    it("listForAgentEffective excludes a disabled skill's documents and includes an enabled one's (AC-14/AC-15)", async () => {
      const { db } = pg.handle;
      const repo = new DrizzleContextRepository(db);
      const workspaceId = await defaultWorkspaceId();
      const repoId = await getSeededRepoId();

      const [agent] = await db
        .insert(t.agents)
        .values({ workspaceId, name: 'Effective agent', provider: 'openai', model: 'gpt-4o-mini', systemPrompt: 'x' })
        .returning();
      const [enabledSkill] = await db
        .insert(t.skills)
        .values({ workspaceId, name: 'Enabled', description: 'd', type: 'custom', source: 'manual', body: 'b', enabled: true })
        .returning();
      const [disabledSkill] = await db
        .insert(t.skills)
        .values({ workspaceId, name: 'Disabled', description: 'd', type: 'custom', source: 'manual', body: 'b', enabled: false })
        .returning();
      await db.insert(t.agentSkills).values([
        { agentId: agent!.id, skillId: enabledSkill!.id, order: 0 },
        { agentId: agent!.id, skillId: disabledSkill!.id, order: 1 },
      ]);

      await repo.replaceFor(workspaceId, 'skill', enabledSkill!.id, repoId, ['docs/from-enabled.md']);
      await repo.replaceFor(workspaceId, 'skill', disabledSkill!.id, repoId, ['docs/from-disabled.md']);
      await repo.replaceFor(workspaceId, 'agent', agent!.id, repoId, ['docs/direct.md']);

      const rows = await repo.listForAgentEffective(workspaceId, agent!.id, repoId);
      const paths = rows.map((r) => r.path).sort();
      expect(paths).toEqual(['docs/direct.md', 'docs/from-enabled.md']);
      expect(paths).not.toContain('docs/from-disabled.md');

      const direct = rows.find((r) => r.path === 'docs/direct.md');
      expect(direct?.source).toBe('agent');
      const viaSkill = rows.find((r) => r.path === 'docs/from-enabled.md');
      expect(viaSkill?.source).toBe('skill');
      expect(viaSkill?.skillName).toBe('Enabled');
    });
  });
});
