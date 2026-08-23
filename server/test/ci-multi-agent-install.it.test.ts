/**
 * SPEC-05 (`specs/SPEC-05-multi-agent-ci-per-repo.md`) — install-time
 * namespace derivation, uniqueness, persistence, legacy freeze and the
 * shared-branch/PR behavior, exercised through the REAL
 * `POST /agents/:id/export-ci{,/preview}` routes with a `MockGitHubClient`
 * injected via `ContainerOverrides.github` (no real GitHub token needed —
 * `server/AGENTS.md`, `server/test/eval-read-apis.it.test.ts`'s harness
 * shape).
 *
 * Oracle: the spec's EARS acceptance criteria (AC-2, AC-4, AC-5, AC-6, AC-7,
 * AC-8, AC-9, AC-10, AC-11, AC-12, AC-13, AC-14, AC-15, AC-17, AC-26, AC-27,
 * AC-29, AC-37) and the plan's WI5 ("resolveLayout … existing installation →
 * reuse its own persisted namespace/manifestPath verbatim … no existing →
 * deriveNamespace uniformly, including the FIRST agent on a fresh repo")
 * derived BEFORE reading `service.ts`'s own implementation beyond exported
 * signatures. This module has ZERO prior test coverage — SPEC-04 baseline
 * behavior this file also exercises (shared branch/PR reuse, AC-9/AC-40's
 * "update keeps the token" and "no half-state" guarantees) is net-new
 * coverage too, not just the SPEC-05 delta.
 *
 * PRECONDITION: `agent-runner/dist/index.js` must exist —
 * `cd agent-runner && pnpm build` — `generateFiles`'s `readRunnerBundle()`
 * has no injectable dependency and reads that file from disk unconditionally
 * (`bundle.ts`).
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
  console.warn('[ci-multi-agent-install] Docker not available — skipping integration tests.');
}

d('SPEC-05 — multi-agent CI per repository: install-time namespace behavior', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoSeq = 0;

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp(github: MockGitHubClient) {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({ config, db: pg.handle.db, overrides: { github } });
  }

  function freshRepo(): string {
    return `acme/repo-${repoSeq++}-${Date.now()}`;
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

  function exportInput(repo: string, overrides: Record<string, unknown> = {}) {
    return {
      repo,
      target: 'gha',
      post_as: 'github_review',
      triggers: ['opened', 'synchronize', 'reopened'],
      base: 'main',
      ingest_url: 'https://studio.example.com/ci/ingest',
      ...overrides,
    };
  }

  async function install(
    app: Awaited<ReturnType<typeof buildApp>>,
    agentId: string,
    repo: string,
    overrides: Record<string, unknown> = {},
  ) {
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: exportInput(repo, overrides),
    });
    return res;
  }

  it('AC-17: the FIRST agent ever installed on a fresh repo IS namespaced — no "first agent gets short paths" case', async () => {
    const github = new MockGitHubClient();
    const app = await makeApp(github);
    const repo = freshRepo();
    const agentId = await createAgent(app, 'Security Reviewer');

    const res = await install(app, agentId, repo);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.installation.ingest_secret_name).toBe('DEVDIGEST_INGEST_TOKEN_SECURITY_REVIEWER');
    // AC-5: exactly the namespaced path set.
    const paths = body.files.map((f: { path: string }) => f.path).sort();
    expect(paths).toEqual(
      [
        '.devdigest/security-reviewer/agents/security-reviewer.yaml',
        '.devdigest/security-reviewer/memory.jsonl',
        '.devdigest/runner/index.js',
        '.github/workflows/devdigest-review-security-reviewer.yml',
      ].sort(),
    );

    await app.close();
  });

  it('AC-3: a client-supplied "namespace"-shaped extra body field changes NOTHING — the namespace is always server-derived', async () => {
    const github = new MockGitHubClient();
    const app = await makeApp(github);
    const repo = freshRepo();
    const agentId = await createAgent(app, 'Client Supplied Namespace Agent');

    // Neither the route schema nor CiExportInput declares a `namespace`
    // field (AC-3) — an extra body field named like one must be silently
    // ignored (zod's default non-strict object parsing), never reach a
    // committed file path.
    const withExtraField = await install(app, agentId, repo, { namespace: '../../etc/passwd' });
    expect(withExtraField.statusCode).toBe(200);
    const secretName = withExtraField.json().installation.ingest_secret_name;
    // Derived purely from the agent's OWN name via slugify — never from the
    // attempted client-supplied value.
    expect(secretName).toBe('DEVDIGEST_INGEST_TOKEN_CLIENT_SUPPLIED_NAMESPACE_AGENT');
    const paths: string[] = withExtraField.json().files.map((f: { path: string }) => f.path);
    for (const p of paths) {
      expect(p).not.toContain('etc/passwd');
      expect(p).not.toContain('..');
    }

    await app.close();
  });

  it('AC-5: an agent with two linked skills gets exactly one skill file each, under its namespace', async () => {
    const github = new MockGitHubClient();
    const app = await makeApp(github);
    const repo = freshRepo();
    const agentId = await createAgent(app, 'Api Contract Reviewer');

    const skillA = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: 'Rubric A', description: 'd', type: 'rubric', source: 'manual', body: 'Body A' },
      })
    ).json();
    const skillB = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: 'Rubric B', description: 'd', type: 'rubric', source: 'manual', body: 'Body B' },
      })
    ).json();
    await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/skills`,
      payload: { skill_ids: [skillA.id, skillB.id] },
    });

    const res = await install(app, agentId, repo);
    expect(res.statusCode).toBe(200);
    const paths: string[] = res.json().files.map((f: { path: string }) => f.path);
    expect(paths).toContain('.devdigest/api-contract-reviewer/skills/rubric-a.md');
    expect(paths).toContain('.devdigest/api-contract-reviewer/skills/rubric-b.md');
    expect(paths.filter((p) => p.startsWith('.devdigest/api-contract-reviewer/skills/'))).toHaveLength(2);

    await app.close();
  });

  it('AC-2/E-2: two agents whose names slugify identically get two DISTINCT namespaces on one repo', async () => {
    const github = new MockGitHubClient();
    const app = await makeApp(github);
    const repo = freshRepo();
    const agentA = await createAgent(app, 'Security Reviewer');
    const agentB = await createAgent(app, 'security-reviewer');

    const resA = await install(app, agentA, repo);
    const resB = await install(app, agentB, repo);
    expect(resA.statusCode).toBe(200);
    expect(resB.statusCode).toBe(200);

    const nsA = resA.json().installation.ingest_secret_name;
    const nsB = resB.json().installation.ingest_secret_name;
    expect(nsA).not.toBe(nsB);

    await app.close();
  });

  it('AC-4/AC-26: renaming the agent between two exports does NOT change its persisted namespace or secret name', async () => {
    const github = new MockGitHubClient();
    const app = await makeApp(github);
    const repo = freshRepo();
    const agentId = await createAgent(app, 'Original Name');

    const first = await install(app, agentId, repo);
    const firstSecret = first.json().installation.ingest_secret_name;
    const firstManifestPath = first
      .json()
      .files.map((f: { path: string }) => f.path)
      .find((p: string) => p.endsWith('.yaml'));

    await app.inject({ method: 'PUT', url: `/agents/${agentId}`, payload: { name: 'Renamed Agent' } });

    const second = await install(app, agentId, repo);
    expect(second.json().installation.ingest_secret_name).toBe(firstSecret);
    const secondManifestPath = second
      .json()
      .files.map((f: { path: string }) => f.path)
      .find((p: string) => p.endsWith('.yaml'));
    expect(secondManifestPath).toBe(firstManifestPath);

    // No second manifest anywhere in the committed tree for this agent's own namespace.
    const manifestPaths = second
      .json()
      .files.map((f: { path: string }) => f.path)
      .filter((p: string) => p.endsWith('.yaml'));
    expect(manifestPaths).toHaveLength(1);

    await app.close();
  });

  it('AC-9: re-exporting the SAME agent updates the row (no new row) and keeps the existing token hash untouched', async () => {
    const github = new MockGitHubClient();
    const app = await makeApp(github);
    const repo = freshRepo();
    const agentId = await createAgent(app, 'Stable Agent');

    await install(app, agentId, repo);
    const [rowAfterFirst] = await pg.handle.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.agentId, agentId));

    await install(app, agentId, repo);
    const rowsAfterSecond = await pg.handle.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.agentId, agentId));

    expect(rowsAfterSecond).toHaveLength(1);
    expect(rowsAfterSecond[0]!.tokenHash).toBe(rowAfterFirst!.tokenHash);

    await app.close();
  });

  it('AC-11: exporting a DIFFERENT agent to an already-installed repo succeeds — no confirmation, no deletion, two rows, two namespaces, two token hashes', async () => {
    const github = new MockGitHubClient();
    const app = await makeApp(github);
    const repo = freshRepo();
    const agentA = await createAgent(app, 'First Agent');
    const agentB = await createAgent(app, 'Second Agent');

    const resA = await install(app, agentA, repo);
    expect(resA.statusCode).toBe(200);

    // No replace_existing flag sent at all — AC-11: this must NOT 409.
    const resB = await install(app, agentB, repo);
    expect(resB.statusCode).toBe(200);

    const rows = await pg.handle.db.select().from(t.ciInstallations).where(eq(t.ciInstallations.repo, repo));
    expect(rows).toHaveLength(2);
    const namespaces = rows.map((r) => r.namespace);
    expect(new Set(namespaces).size).toBe(2);
    const tokenHashes = rows.map((r) => r.tokenHash);
    expect(new Set(tokenHashes).size).toBe(2);
    // agent A's row must still exist, untouched.
    expect(rows.some((r) => r.agentId === agentA)).toBe(true);
  });

  it('AC-30: GET /agents/:id/ci-installations for agent A never lists agent B\'s installation on the same repo', async () => {
    const github = new MockGitHubClient();
    const app = await makeApp(github);
    const repo = freshRepo();
    const agentA = await createAgent(app, 'List Scope Agent A');
    const agentB = await createAgent(app, 'List Scope Agent B');
    await install(app, agentA, repo);
    await install(app, agentB, repo);

    const listA = await app.inject({ method: 'GET', url: `/agents/${agentA}/ci-installations` });
    const listB = await app.inject({ method: 'GET', url: `/agents/${agentB}/ci-installations` });

    expect(listA.json()).toHaveLength(1);
    expect(listA.json()[0].agent_id).toBe(agentA);
    expect(listB.json()).toHaveLength(1);
    expect(listB.json()[0].agent_id).toBe(agentB);

    await app.close();
  });

  it('AC-12: replace_existing true vs false produce IDENTICAL outcomes on the gha path (the field is ignored)', async () => {
    const repo = freshRepo();

    const githubTrue = new MockGitHubClient();
    const appTrue = await makeApp(githubTrue);
    const agentA1 = await createAgent(appTrue, 'Agent One');
    const agentB1 = await createAgent(appTrue, 'Agent Two');
    await install(appTrue, agentA1, repo);
    const resTrue = await install(appTrue, agentB1, repo, { replace_existing: true });
    await appTrue.close();

    const repo2 = freshRepo();
    const githubFalse = new MockGitHubClient();
    const appFalse = await makeApp(githubFalse);
    const agentA2 = await createAgent(appFalse, 'Agent One');
    const agentB2 = await createAgent(appFalse, 'Agent Two');
    await install(appFalse, agentA2, repo2);
    const resFalse = await install(appFalse, agentB2, repo2, { replace_existing: false });
    await appFalse.close();

    expect(resTrue.statusCode).toBe(resFalse.statusCode);
    expect(resTrue.statusCode).toBe(200);
    // Same shape of outcome — an ordinary successful install either way,
    // no half-deleted/replaced row on either.
    const rowsTrueRepo = await pg.handle.db.select().from(t.ciInstallations).where(eq(t.ciInstallations.repo, repo));
    const rowsFalseRepo = await pg.handle.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.repo, repo2));
    expect(rowsTrueRepo).toHaveLength(2);
    expect(rowsFalseRepo).toHaveLength(2);
  });

  it('AC-8: agent B\'s committed payload contains no path under agent A\'s namespace and not agent A\'s workflow file', async () => {
    const github = new MockGitHubClient();
    const app = await makeApp(github);
    const repo = freshRepo();
    const agentA = await createAgent(app, 'Alpha Agent');
    const agentB = await createAgent(app, 'Beta Agent');

    await install(app, agentA, repo);
    const commitA = github.committed[github.committed.length - 1]!;
    const pathsA = commitA.files.map((f) => f.path);
    const agentANamespaceDir = pathsA.find((p) => p.startsWith('.devdigest/') && p.includes('/agents/'))!
      .split('/agents/')[0]!;
    const agentAWorkflowFile = pathsA.find((p) => p.startsWith('.github/workflows/'))!;

    await install(app, agentB, repo);
    const commitB = github.committed[github.committed.length - 1]!;
    const pathsB = commitB.files.map((f) => f.path);

    for (const p of pathsB) {
      if (p === '.devdigest/runner/index.js') continue; // AC-6's one intentional shared path
      expect(p.startsWith(`${agentANamespaceDir}/`)).toBe(false);
      expect(p).not.toBe(agentAWorkflowFile);
    }

    await app.close();
  });

  it('AC-6: two installations on one repo commit exactly one .devdigest/runner/index.js path each time (a single shared bundle)', async () => {
    const github = new MockGitHubClient();
    const app = await makeApp(github);
    const repo = freshRepo();
    const agentA = await createAgent(app, 'Runner Shared A');
    const agentB = await createAgent(app, 'Runner Shared B');

    await install(app, agentA, repo);
    await install(app, agentB, repo);

    for (const commit of github.committed) {
      const runnerPaths = commit.files.filter((f) => f.path === '.devdigest/runner/index.js');
      expect(runnerPaths).toHaveLength(1);
    }

    await app.close();
  });

  it('AC-10: two agents\' exports on one repo produce ONE branch and ONE reused pull request', async () => {
    const github = new MockGitHubClient();
    const app = await makeApp(github);
    const repo = freshRepo();
    const agentA = await createAgent(app, 'Branch Share A');
    const agentB = await createAgent(app, 'Branch Share B');

    const resA = await install(app, agentA, repo);
    const resB = await install(app, agentB, repo);

    const branches = new Set(github.committed.map((c) => c.branch));
    expect(branches.size).toBe(1);
    expect([...branches][0]).toBe('devdigest/ci');

    // Only ONE PR was ever opened — the second export reused it.
    expect(github.openedPrs).toHaveLength(1);
    expect(resA.json().pr_url).toBe(resB.json().pr_url);

    await app.close();
  });

  it('AC-7: after any export, exactly one manifest yaml exists under this export\'s own namespace directory', async () => {
    const github = new MockGitHubClient();
    const app = await makeApp(github);
    const repo = freshRepo();
    const agentId = await createAgent(app, 'Manifest Count Agent');

    const res = await install(app, agentId, repo);
    const paths: string[] = res.json().files.map((f: { path: string }) => f.path);
    const manifestPaths = paths.filter((p) => p.includes('/agents/') && p.endsWith('.yaml'));
    expect(manifestPaths).toHaveLength(1);

    await app.close();
  });

  it('AC-13: if opening the PR fails on agent B\'s export, agent A\'s row stays intact and NOTHING is persisted for B', async () => {
    const repo = freshRepo();

    class ThrowingGithub extends MockGitHubClient {
      async openPullRequest(): Promise<{ url: string }> {
        throw new Error('simulated GitHub outage');
      }
      async findOpenPr(): Promise<{ url: string } | null> {
        return null; // never an existing PR to reuse — forces the openPullRequest path
      }
    }
    const github = new ThrowingGithub();
    const app = await makeApp(github);
    const agentA = await createAgent(app, 'Survives Agent');
    const agentB = await createAgent(app, 'Fails Agent');

    // Agent A installs successfully via a NORMAL github client swapped in
    // only for this one call, then we swap to the throwing client for B.
    const okGithub = new MockGitHubClient();
    const appOk = await makeApp(okGithub);
    // Re-create the same agents under the SAME db (workspace-scoped, agent
    // ids are stable across app instances since they share `pg.handle.db`).
    const resA = await install(appOk, agentA, repo);
    expect(resA.statusCode).toBe(200);
    await appOk.close();

    const resB = await install(app, agentB, repo);
    expect(resB.statusCode).toBe(502);

    const rows = await pg.handle.db.select().from(t.ciInstallations).where(eq(t.ciInstallations.repo, repo));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.agentId).toBe(agentA);

    await app.close();
  });

  it('AC-27: agent A\'s token hash is untouched by agent B\'s export AND by agent B\'s deletion', async () => {
    const github = new MockGitHubClient();
    const app = await makeApp(github);
    const repo = freshRepo();
    const agentA = await createAgent(app, 'Token Independent A');
    const agentB = await createAgent(app, 'Token Independent B');

    await install(app, agentA, repo);
    const [rowA1] = await pg.handle.db.select().from(t.ciInstallations).where(eq(t.ciInstallations.agentId, agentA));

    await install(app, agentB, repo);
    const [rowA2] = await pg.handle.db.select().from(t.ciInstallations).where(eq(t.ciInstallations.agentId, agentA));
    expect(rowA2!.tokenHash).toBe(rowA1!.tokenHash);

    const [rowB] = await pg.handle.db.select().from(t.ciInstallations).where(eq(t.ciInstallations.agentId, agentB));
    await app.inject({ method: 'DELETE', url: `/ci/installations/${rowB!.id}` });

    const [rowA3] = await pg.handle.db.select().from(t.ciInstallations).where(eq(t.ciInstallations.agentId, agentA));
    expect(rowA3!.tokenHash).toBe(rowA1!.tokenHash);

    await app.close();
  });

  it('AC-29: no minted token VALUE appears in any generated file of a two-agent repo', async () => {
    const github = new MockGitHubClient();
    const app = await makeApp(github);
    const repo = freshRepo();
    const agentA = await createAgent(app, 'Scan A');
    const agentB = await createAgent(app, 'Scan B');

    const resA = await install(app, agentA, repo);
    const resB = await install(app, agentB, repo);
    const tokenA: string = resA.json().ingest_token;
    const tokenB: string = resB.json().ingest_token;
    expect(tokenA).toBeTruthy();
    expect(tokenB).toBeTruthy();
    expect(tokenA).not.toBe(tokenB);

    for (const commit of github.committed) {
      for (const file of commit.files) {
        expect(file.contents).not.toContain(tokenA);
        expect(file.contents).not.toContain(tokenB);
      }
    }

    await app.close();
  });

  describe('AC-14/AC-15: legacy installations stay frozen on the unnamespaced layout', () => {
    async function insertLegacyInstallation(agentId: string, repo: string) {
      const [row] = await pg.handle.db
        .insert(t.ciInstallations)
        .values({
          agentId,
          repo,
          targetType: 'gha',
          tokenHash: 'a'.repeat(64),
          ingestUrl: 'https://studio.example.com/ci/ingest',
          workflowVersion: 1,
          agentVersion: 1,
          postAs: 'github_review',
          triggers: ['opened', 'synchronize', 'reopened'],
          baseBranch: 'main',
          manifestPath: '.devdigest/agents/legacy-agent.yaml',
          namespace: null, // legacy — the definition of AC-14
        })
        .returning();
      return row!;
    }

    it('AC-14: re-exporting a legacy installation twice keeps a byte-identical path set and secret name each time', async () => {
      const github = new MockGitHubClient();
      const app = await makeApp(github);
      const repo = freshRepo();
      const agentId = await createAgent(app, 'Legacy Agent');
      await insertLegacyInstallation(agentId, repo);

      const first = await install(app, agentId, repo);
      const second = await install(app, agentId, repo);

      expect(first.json().installation.ingest_secret_name).toBe('DEVDIGEST_INGEST_TOKEN');
      expect(second.json().installation.ingest_secret_name).toBe('DEVDIGEST_INGEST_TOKEN');

      const pathsFirst = first
        .json()
        .files.map((f: { path: string }) => f.path)
        .sort();
      const pathsSecond = second
        .json()
        .files.map((f: { path: string }) => f.path)
        .sort();
      expect(pathsSecond).toEqual(pathsFirst);
      expect(pathsFirst).toContain('.devdigest/agents/legacy-agent.yaml');
      expect(pathsFirst).toContain('.github/workflows/devdigest-review.yml');

      await app.close();
    });

    it('AC-15: a legacy installation and a new namespaced installation on the SAME repo both hold exactly one manifest each, in separate directories', async () => {
      const github = new MockGitHubClient();
      const app = await makeApp(github);
      const repo = freshRepo();
      const legacyAgentId = await createAgent(app, 'Legacy Coexist Agent');
      await insertLegacyInstallation(legacyAgentId, repo);
      const newAgentId = await createAgent(app, 'New Namespaced Agent');

      const legacyRes = await install(app, legacyAgentId, repo);
      const newRes = await install(app, newAgentId, repo);

      const legacyManifests = legacyRes
        .json()
        .files.map((f: { path: string }) => f.path)
        .filter((p: string) => p.startsWith('.devdigest/agents/') && p.endsWith('.yaml'));
      expect(legacyManifests).toHaveLength(1);

      const newManifests = newRes
        .json()
        .files.map((f: { path: string }) => f.path)
        .filter((p: string) => p.startsWith('.devdigest/new-namespaced-agent/agents/') && p.endsWith('.yaml'));
      expect(newManifests).toHaveLength(1);

      await app.close();
    });
  });

  it('AC-37: a foreign workspace\'s taken namespace on a same-named repo does NOT leak into this workspace\'s disambiguation', async () => {
    const github = new MockGitHubClient();
    const app = await makeApp(github);
    const repo = freshRepo();

    // A DIFFERENT workspace, with an installation on the SAME repo string,
    // whose namespace is exactly what "Sec Reviewer" would slugify to.
    const [foreignWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `foreign-${Date.now()}-${Math.random()}` })
      .returning();
    const [foreignAgent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId: foreignWs!.id,
        name: 'Foreign Sec Reviewer',
        provider: 'openai',
        model: 'gpt-4o-mini',
        systemPrompt: 'x',
      })
      .returning();
    await pg.handle.db.insert(t.ciInstallations).values({
      agentId: foreignAgent!.id,
      repo,
      targetType: 'gha',
      tokenHash: 'b'.repeat(64),
      ingestUrl: 'https://studio.example.com/ci/ingest',
      workflowVersion: 2,
      agentVersion: 1,
      postAs: 'github_review',
      triggers: ['opened'],
      baseBranch: 'main',
      manifestPath: '.devdigest/sec-reviewer/agents/foreign-sec-reviewer.yaml',
      namespace: 'sec-reviewer',
    });

    // Now, in the DEFAULT workspace (the one every `app.inject` call above
    // resolves to via `getContext`/LocalNoAuthProvider), install an agent
    // that ALSO slugifies to "sec-reviewer" on the SAME repo string.
    const agentId = await createAgent(app, 'Sec Reviewer');
    const res = await install(app, agentId, repo);
    expect(res.statusCode).toBe(200);

    // If the foreign workspace's row had leaked into this workspace's
    // taken-namespace set, this would have been disambiguated to
    // "sec-reviewer-2" — it must NOT be, because that row belongs to a
    // DIFFERENT workspace entirely (AC-37).
    expect(res.json().installation.ingest_secret_name).toBe('DEVDIGEST_INGEST_TOKEN_SEC_REVIEWER');

    await app.close();
  });
});
