/**
 * WI5 — one-click "create case from finding"
 * (`docs/plans/eval-pipeline.md` Phase B). Oracle: `specs/eval-pipeline.md`
 * AC-1, AC-2, AC-3, AC-5, AC-6, AC-7, AC-8, AC-9, Q-6, D-7 — derived from the
 * plan/spec BEFORE reading `modules/eval/{routes,service,repository}.ts` for
 * anything beyond exact route paths, field names and error codes.
 *
 * Exercised over real HTTP (`app.inject`) against a real Postgres
 * (testcontainers), following `test/reviews.it.test.ts`'s
 * `setupRepoAndPr`-style fixture pattern.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[eval-create-from-finding] Docker not available — skipping integration tests.');
}

d('POST /findings/:id/eval-case — one-click create-from-finding', () => {
  let pg: PgFixture;
  let defaultWorkspaceId: string;
  let repoSeq = 0;

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    defaultWorkspaceId = seeded.workspaceId;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({ config, db: pg.handle.db });
  }

  /**
   * Builds one repo/PR/review/finding fixture, fully controllable per-test:
   * workspace, review.agentId, finding kind, decision timestamps, and
   * whether the finding's file has a stored, non-null patch.
   */
  async function setupFixture(opts: {
    workspaceId?: string;
    agentId?: string | null;
    findingKind?: string;
    accepted?: boolean;
    dismissed?: boolean;
    withPatch?: boolean;
    file?: string;
  }) {
    const workspaceId = opts.workspaceId ?? defaultWorkspaceId;
    const db = pg.handle.db;
    const n = repoSeq++;
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: `svc-${n}`, fullName: `acme/svc-${n}` })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 1,
        title: `PR ${n}`,
        author: 'dev',
        branch: `feat/${n}`,
        base: 'main',
        headSha: `sha-${n}`,
        status: 'needs_review',
        body: `Body for PR ${n}`,
      })
      .returning();

    const file = opts.file ?? 'src/config.ts';
    if (opts.withPatch !== false) {
      await db.insert(t.prFiles).values({
        prId: pr!.id,
        path: file,
        patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_x",\n   redisUrl: x,',
      });
    }
    // opts.withPatch === false → no pr_files row for this path at all (AC-8).

    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        kind: 'review',
        agentId: opts.agentId === undefined ? null : opts.agentId,
      })
      .returning();

    const [finding] = await db
      .insert(t.findings)
      .values({
        reviewId: review!.id,
        file,
        startLine: 12,
        endLine: 12,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key',
        rationale: 'A live key is committed.',
        confidence: 0.95,
        kind: opts.findingKind ?? 'finding',
        acceptedAt: opts.accepted ? new Date() : null,
        dismissedAt: opts.dismissed ? new Date() : null,
      })
      .returning();

    return { repo: repo!, pr: pr!, review: review!, finding: finding! };
  }

  async function createAgentInWorkspace(workspaceId: string, name: string): Promise<string> {
    const [row] = await pg.handle.db
      .insert(t.agents)
      .values({ workspaceId, name, provider: 'openai', model: 'gpt-4o-mini', systemPrompt: 'x' })
      .returning();
    return row!.id;
  }

  it('AC-1/AC-3: an ACCEPTED finding creates a case with exactly one must_find expectation at file:start_line-end_line', async () => {
    const app = await makeApp();
    const agentId = await createAgentInWorkspace(defaultWorkspaceId, 'Agent A1');
    const { finding } = await setupFixture({ agentId, accepted: true, file: 'src/config.ts' });

    const res = await app.inject({ method: 'POST', url: `/findings/${finding.id}/eval-case`, payload: {} });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.expected_output.must_find).toHaveLength(1);
    expect(body.expected_output.must_not_flag).toHaveLength(0);
    expect(body.expected_output.must_find[0]).toMatchObject({
      file: 'src/config.ts',
      start_line: 12,
      end_line: 12,
    });

    await app.close();
  });

  it('AC-2/AC-3: a DISMISSED finding creates a case with exactly one must_not_flag expectation over the same file/range', async () => {
    const app = await makeApp();
    const agentId = await createAgentInWorkspace(defaultWorkspaceId, 'Agent A2');
    const { finding } = await setupFixture({ agentId, dismissed: true, file: 'src/config.ts' });

    const res = await app.inject({ method: 'POST', url: `/findings/${finding.id}/eval-case`, payload: {} });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.expected_output.must_not_flag).toHaveLength(1);
    expect(body.expected_output.must_find).toHaveLength(0);
    expect(body.expected_output.must_not_flag[0]).toMatchObject({
      file: 'src/config.ts',
      start_line: 12,
      end_line: 12,
    });

    await app.close();
  });

  it('AC-3: a PENDING finding (neither accepted_at nor dismissed_at) refuses and writes nothing', async () => {
    const app = await makeApp();
    const agentId = await createAgentInWorkspace(defaultWorkspaceId, 'Agent A3');
    const { finding } = await setupFixture({ agentId }); // neither accepted nor dismissed

    const before = await pg.handle.db.select().from(t.evalCases);
    const res = await app.inject({ method: 'POST', url: `/findings/${finding.id}/eval-case`, payload: {} });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('finding_not_decided');
    const after = await pg.handle.db.select().from(t.evalCases);
    expect(after).toHaveLength(before.length);

    await app.close();
  });

  it('D-7: a body-supplied "kind" cannot override the server-derived expectation kind', async () => {
    const app = await makeApp();
    const agentId = await createAgentInWorkspace(defaultWorkspaceId, 'Agent A3b');
    const { finding } = await setupFixture({ agentId, accepted: true, file: 'src/config.ts' });

    // The finding is ACCEPTED — the body's claimed "kind" must have no effect.
    const res = await app.inject({
      method: 'POST',
      url: `/findings/${finding.id}/eval-case`,
      payload: { kind: 'must_not_flag' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.expected_output.must_find).toHaveLength(1); // still derived from accepted_at
    expect(body.expected_output.must_not_flag).toHaveLength(0);

    await app.close();
  });

  it('AC-6: a review with a null agent_id refuses and writes nothing', async () => {
    const app = await makeApp();
    const { finding } = await setupFixture({ agentId: null, accepted: true });

    const before = await pg.handle.db.select().from(t.evalCases);
    const res = await app.inject({ method: 'POST', url: `/findings/${finding.id}/eval-case`, payload: {} });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('review_missing_agent');
    const after = await pg.handle.db.select().from(t.evalCases);
    expect(after).toHaveLength(before.length);

    await app.close();
  });

  it('AC-8: a finding whose file has no pr_files row with a non-null patch refuses and writes nothing (never an empty diff)', async () => {
    const app = await makeApp();
    const agentId = await createAgentInWorkspace(defaultWorkspaceId, 'Agent A4');
    const { finding } = await setupFixture({ agentId, accepted: true, withPatch: false });

    const before = await pg.handle.db.select().from(t.evalCases);
    const res = await app.inject({ method: 'POST', url: `/findings/${finding.id}/eval-case`, payload: {} });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('no_diff_available');
    const after = await pg.handle.db.select().from(t.evalCases);
    expect(after).toHaveLength(before.length);

    await app.close();
  });

  it('AC-5: a finding outside the caller\'s workspace 404s and writes nothing', async () => {
    const app = await makeApp();
    const [foreignWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `foreign-${Date.now()}-${Math.random()}` })
      .returning();
    const foreignAgentId = await createAgentInWorkspace(foreignWs!.id, 'Foreign Agent');
    const { finding } = await setupFixture({
      workspaceId: foreignWs!.id,
      agentId: foreignAgentId,
      accepted: true,
    });

    const before = await pg.handle.db.select().from(t.evalCases);
    // The app always resolves the caller to the DEFAULT workspace — this
    // finding lives in a different one.
    const res = await app.inject({ method: 'POST', url: `/findings/${finding.id}/eval-case`, payload: {} });
    expect(res.statusCode).toBe(404);
    const after = await pg.handle.db.select().from(t.evalCases);
    expect(after).toHaveLength(before.length);

    await app.close();
  });

  it('AC-5: a nonexistent finding id also 404s (does not leak cross-tenant existence via a different status)', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: `/findings/00000000-0000-0000-0000-000000000000/eval-case`,
      payload: {},
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('Q-6: a full-file-kind finding (secret_leak) gets match_scope "file"; an ordinary finding gets "range"', async () => {
    const app = await makeApp();
    const agentId = await createAgentInWorkspace(defaultWorkspaceId, 'Agent A5');

    const fullFile = await setupFixture({
      agentId,
      accepted: true,
      findingKind: 'secret_leak',
      file: 'src/secrets.ts',
    });
    const resFullFile = await app.inject({
      method: 'POST',
      url: `/findings/${fullFile.finding.id}/eval-case`,
      payload: {},
    });
    expect(resFullFile.statusCode).toBe(201);
    expect(resFullFile.json().expected_output.must_find[0].match_scope).toBe('file');

    const ordinary = await setupFixture({
      agentId,
      accepted: true,
      findingKind: 'finding',
      file: 'src/other.ts',
    });
    const resOrdinary = await app.inject({
      method: 'POST',
      url: `/findings/${ordinary.finding.id}/eval-case`,
      payload: {},
    });
    expect(resOrdinary.statusCode).toBe(201);
    expect(resOrdinary.json().expected_output.must_find[0].match_scope).toBe('range');

    await app.close();
  });

  it('Q-6: each of the other three full-file kinds (lethal_trifecta, phantom, hook) also gets match_scope "file"', async () => {
    const app = await makeApp();
    const agentId = await createAgentInWorkspace(defaultWorkspaceId, 'Agent A6');

    for (const kind of ['lethal_trifecta', 'phantom', 'hook']) {
      const { finding } = await setupFixture({ agentId, accepted: true, findingKind: kind, file: `src/${kind}.ts` });
      const res = await app.inject({ method: 'POST', url: `/findings/${finding.id}/eval-case`, payload: {} });
      expect(res.statusCode).toBe(201);
      expect(res.json().expected_output.must_find[0].match_scope).toBe('file');
    }

    await app.close();
  });

  it('AC-9: the created expectation records source_finding_id as provenance', async () => {
    const app = await makeApp();
    const agentId = await createAgentInWorkspace(defaultWorkspaceId, 'Agent A7');
    const { finding } = await setupFixture({ agentId, accepted: true });

    const res = await app.inject({ method: 'POST', url: `/findings/${finding.id}/eval-case`, payload: {} });
    expect(res.statusCode).toBe(201);
    expect(res.json().expected_output.must_find[0].source_finding_id).toBe(finding.id);

    await app.close();
  });

  it('AC-6: owner is reviews.agent_id with owner_kind "agent"', async () => {
    const app = await makeApp();
    const agentId = await createAgentInWorkspace(defaultWorkspaceId, 'Agent A8');
    const { finding } = await setupFixture({ agentId, accepted: true });

    const res = await app.inject({ method: 'POST', url: `/findings/${finding.id}/eval-case`, payload: {} });
    const body = res.json();
    expect(body.owner_id).toBe(agentId);
    expect(body.owner_kind).toBe('agent');

    await app.close();
  });

  it('AC-7: input_diff is pinned at creation and stays unchanged after the source PR\'s pr_files are refreshed (deleted + reinserted)', async () => {
    const app = await makeApp();
    const agentId = await createAgentInWorkspace(defaultWorkspaceId, 'Agent A9');
    const { finding, pr } = await setupFixture({ agentId, accepted: true, file: 'src/config.ts' });

    const created = (
      await app.inject({ method: 'POST', url: `/findings/${finding.id}/eval-case`, payload: {} })
    ).json();
    const pinnedDiff = created.input_diff as string;
    expect(pinnedDiff).toContain('src/config.ts');

    // Simulate GET /pulls/:id's refresh behaviour: delete and reinsert
    // pr_files with a DIFFERENT patch for the same path (E-1).
    await pg.handle.db.delete(t.prFiles).where(eq(t.prFiles.prId, pr.id));
    await pg.handle.db.insert(t.prFiles).values({
      prId: pr.id,
      path: 'src/config.ts',
      patch: '@@ -1,1 +1,1 @@\n-completely different\n+patch now',
    });

    const reread = await app.inject({ method: 'GET', url: `/eval-cases/${created.id}` });
    expect(reread.json().input_diff).toBe(pinnedDiff); // unchanged despite the refresh

    await app.close();
  });
});
