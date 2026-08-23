/**
 * WI4 — eval case CRUD + tenancy + caps + read-side degradation
 * (`docs/plans/eval-pipeline.md` Phase B). Oracle: `specs/eval-pipeline.md`
 * AC-13/E-12 (expected_output read-side degradation), AC-42 (tenancy via
 * getContext on every route), AC-43 (the owner_id IDOR surface), AC-46
 * (input_diff size cap) — derived from the plan/spec BEFORE reading
 * `modules/eval/{routes,service,repository}.ts` for anything beyond exact
 * route paths, field names and error codes.
 *
 * Exercised over real HTTP (`app.inject`) against a real Postgres
 * (testcontainers), following `test/agents-versions.it.test.ts` /
 * `test/project-context-write.it.test.ts`'s pattern: `LocalNoAuthProvider`
 * always resolves the caller to the seeded "default" workspace, so a
 * "foreign workspace" is simulated by inserting rows directly into a SECOND
 * workspace via Drizzle and addressing them through the app (which is always
 * scoped to "default").
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MAX_INPUT_DIFF_BYTES } from '../src/modules/eval/constants.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[eval-cases] Docker not available — skipping integration tests.');
}

d('Eval case CRUD — tenancy, owner_id IDOR, expected_output validation, input_diff cap', () => {
  let pg: PgFixture;
  let defaultWorkspaceId: string;

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

  async function createAgentInWorkspace(workspaceId: string, name: string): Promise<string> {
    const [row] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        name,
        provider: 'openai',
        model: 'gpt-4o-mini',
        systemPrompt: 'x',
      })
      .returning();
    return row!.id;
  }

  async function createForeignWorkspace(): Promise<string> {
    const [ws] = await pg.handle.db.insert(t.workspaces).values({ name: `foreign-${Date.now()}-${Math.random()}` }).returning();
    return ws!.id;
  }

  const validExpectedOutput = {
    version: 1,
    must_find: [{ file: 'src/config.ts', start_line: 10, end_line: 12 }],
    must_not_flag: [],
  };

  function caseBody(overrides: Record<string, unknown> = {}) {
    return {
      owner_kind: 'agent',
      owner_id: '',
      name: 'A case',
      input_diff: 'diff --git a/x b/x',
      expected_output: validExpectedOutput,
      ...overrides,
    };
  }

  it('AC-42: cross-workspace GET/PATCH/DELETE all 404 (never a 403-with-detail)', async () => {
    const app = await makeApp();
    const foreignWs = await createForeignWorkspace();
    const foreignAgentId = await createAgentInWorkspace(foreignWs, 'Foreign Agent');

    // A case that lives entirely in the foreign workspace, inserted directly
    // (bypassing the app, which can only ever act as "default").
    const [foreignCase] = await pg.handle.db
      .insert(t.evalCases)
      .values({
        workspaceId: foreignWs,
        ownerKind: 'agent',
        ownerId: foreignAgentId,
        name: 'Foreign case',
        inputDiff: 'diff --git a/x b/x',
        expectedOutput: validExpectedOutput,
      })
      .returning();

    const get = await app.inject({ method: 'GET', url: `/eval-cases/${foreignCase!.id}` });
    expect(get.statusCode).toBe(404);
    expect(get.json().error.code).toBe('not_found');

    const patch = await app.inject({
      method: 'PATCH',
      url: `/eval-cases/${foreignCase!.id}`,
      payload: { name: 'renamed' },
    });
    expect(patch.statusCode).toBe(404);

    const del = await app.inject({ method: 'DELETE', url: `/eval-cases/${foreignCase!.id}` });
    expect(del.statusCode).toBe(404);

    // The row is untouched — the refusal wrote nothing.
    const [stillThere] = await pg.handle.db
      .select()
      .from(t.evalCases)
      .where(eq(t.evalCases.id, foreignCase!.id));
    expect(stillThere?.name).toBe('Foreign case');

    // GET /agents/:id/eval-cases for a foreign agent id 404s too (the owner
    // agent itself is out of the caller's workspace).
    const list = await app.inject({ method: 'GET', url: `/agents/${foreignAgentId}/eval-cases` });
    expect(list.statusCode).toBe(404);

    await app.close();
  });

  it('AC-43: owner_id naming an agent in a DIFFERENT workspace is rejected on create, not silently accepted', async () => {
    const app = await makeApp();
    const foreignWs = await createForeignWorkspace();
    const foreignAgentId = await createAgentInWorkspace(foreignWs, 'Foreign Agent 2');

    const before = await pg.handle.db.select().from(t.evalCases);

    const res = await app.inject({
      method: 'POST',
      url: '/eval-cases',
      payload: caseBody({ owner_id: foreignAgentId }),
    });
    expect(res.statusCode).toBe(404);

    // Nothing was written — this is a refusal, not a silent accept-and-drop.
    const after = await pg.handle.db.select().from(t.evalCases);
    expect(after).toHaveLength(before.length);

    await app.close();
  });

  it('AC-43: owner_id naming an agent in the CALLER\'s own workspace is accepted', async () => {
    const app = await makeApp();
    const agentId = await createAgentInWorkspace(defaultWorkspaceId, 'Local Agent');

    const res = await app.inject({
      method: 'POST',
      url: '/eval-cases',
      payload: caseBody({ owner_id: agentId }),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().owner_id).toBe(agentId);

    await app.close();
  });

  it('AC-43: PATCHing an existing case\'s owner_id to a foreign agent is rejected, and the case\'s owner is left unchanged', async () => {
    const app = await makeApp();
    const agentId = await createAgentInWorkspace(defaultWorkspaceId, 'Local Agent 2');
    const foreignWs = await createForeignWorkspace();
    const foreignAgentId = await createAgentInWorkspace(foreignWs, 'Foreign Agent 3');

    const created = (
      await app.inject({ method: 'POST', url: '/eval-cases', payload: caseBody({ owner_id: agentId }) })
    ).json();

    const patch = await app.inject({
      method: 'PATCH',
      url: `/eval-cases/${created.id}`,
      payload: { owner_id: foreignAgentId },
    });
    expect(patch.statusCode).toBe(404);

    const reread = await app.inject({ method: 'GET', url: `/eval-cases/${created.id}` });
    expect(reread.json().owner_id).toBe(agentId); // unchanged

    await app.close();
  });

  it('AC-11/write validation: an expected_output missing required fields is rejected (422)', async () => {
    const app = await makeApp();
    const agentId = await createAgentInWorkspace(defaultWorkspaceId, 'Local Agent 3');

    const res = await app.inject({
      method: 'POST',
      url: '/eval-cases',
      payload: caseBody({
        owner_id: agentId,
        // Missing start_line/end_line — invalid against EvalExpectationEntry.
        expected_output: { version: 1, must_find: [{ file: 'src/x.ts' }], must_not_flag: [] },
      }),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');

    await app.close();
  });

  it('AC-13/E-12: a hand-corrupted expected_output row degrades to expectation_status "unusable" on read, not a crash', async () => {
    const app = await makeApp();
    const agentId = await createAgentInWorkspace(defaultWorkspaceId, 'Local Agent 4');
    const [corruptRow] = await pg.handle.db
      .insert(t.evalCases)
      .values({
        workspaceId: defaultWorkspaceId,
        ownerKind: 'agent',
        ownerId: agentId,
        name: 'Corrupt case',
        inputDiff: 'diff',
        // Predates the AC-11 contract — an arbitrary shape, as the old
        // z.unknown() column tolerated.
        expectedOutput: { some: 'legacy shape', not: 'an EvalExpectation' },
      })
      .returning();

    const res = await app.inject({ method: 'GET', url: `/eval-cases/${corruptRow!.id}` });
    expect(res.statusCode).toBe(200); // renders, does not throw/500
    const body = res.json();
    expect(body.expectation_status).toBe('unusable');
    expect(body.expected_output).toBeNull();

    // The case list (not just the direct-read route) also renders it, rather
    // than the one bad row breaking the whole page.
    const list = await app.inject({ method: 'GET', url: `/agents/${agentId}/eval-cases` });
    expect(list.statusCode).toBe(200);
    const listed = list.json().find((c: { id: string }) => c.id === corruptRow!.id);
    expect(listed.expectation_status).toBe('unusable');

    await app.close();
  });

  it('AC-46: an input_diff over MAX_INPUT_DIFF_BYTES is rejected with a named error, not silently truncated or accepted', async () => {
    const app = await makeApp();
    const agentId = await createAgentInWorkspace(defaultWorkspaceId, 'Local Agent 5');
    const oversized = 'a'.repeat(MAX_INPUT_DIFF_BYTES + 1);

    const before = await pg.handle.db.select().from(t.evalCases);

    const res = await app.inject({
      method: 'POST',
      url: '/eval-cases',
      payload: caseBody({ owner_id: agentId, input_diff: oversized }),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('diff_too_large');

    const after = await pg.handle.db.select().from(t.evalCases);
    expect(after).toHaveLength(before.length); // nothing written, nothing truncated-and-saved

    await app.close();
  });

  it('AC-46: PATCHing an existing case with an oversized diff is rejected and the stored diff is left unchanged', async () => {
    const app = await makeApp();
    const agentId = await createAgentInWorkspace(defaultWorkspaceId, 'Local Agent 6');
    const created = (
      await app.inject({
        method: 'POST',
        url: '/eval-cases',
        payload: caseBody({ owner_id: agentId, input_diff: 'small diff' }),
      })
    ).json();

    const oversized = 'a'.repeat(MAX_INPUT_DIFF_BYTES + 1);
    const patch = await app.inject({
      method: 'PATCH',
      url: `/eval-cases/${created.id}`,
      payload: { input_diff: oversized },
    });
    expect(patch.statusCode).toBe(422);
    expect(patch.json().error.code).toBe('diff_too_large');

    const reread = await app.inject({ method: 'GET', url: `/eval-cases/${created.id}` });
    expect(reread.json().input_diff).toBe('small diff');

    await app.close();
  });
});
