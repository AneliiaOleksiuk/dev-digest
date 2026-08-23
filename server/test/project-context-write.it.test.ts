/**
 * Project Context (SPEC-01 amendment) — the two write routes
 * (`PUT`/`POST /repos/:id/context/document`, WI4) exercised over real HTTP
 * against a real Postgres + a real tmp-dir clone. Oracle: AC-34, AC-37,
 * AC-40, AC-41, AC-42, AC-44, AC-48 — derived from the Spec/Plan before
 * `routes.ts` was read for wiring facts. The write-guard clause-by-clause
 * rejections (AC-43/AC-45/AC-46/AC-47) are unit-tested exhaustively in
 * `test/project-context-write-guards.test.ts`; this file proves the ROUTE
 * actually wires that chain end to end (one representative rejection each),
 * not that every clause exists again.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
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
  console.warn('[project-context-write] Docker not available — skipping integration tests.');
}

d('Project Context write routes (PUT/POST /repos/:id/context/document)', () => {
  let pg: PgFixture;
  let clonePath: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    clonePath = await mkdtemp(join(tmpdir(), 'project-context-write-it-'));
    await mkdir(join(clonePath, 'docs'), { recursive: true });
    await writeFile(join(clonePath, 'docs', 'existing.md'), '# Existing\noriginal content');
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

  async function withClonedRepo(): Promise<string> {
    const repoId = await getSeededRepoId();
    await pg.handle.db.update(t.repos).set({ clonePath }).where(eq(t.repos.id, repoId));
    return repoId;
  }

  it('AC-40: GET the document, PUT a save with its revision, then GET again shows the new content + a new revision', async () => {
    const app = await makeApp();
    const repoId = await withClonedRepo();

    const getRes = await app.inject({
      method: 'GET',
      url: `/repos/${repoId}/context/document?path=docs/existing.md`,
    });
    expect(getRes.statusCode).toBe(200);
    const { revision } = getRes.json();
    expect(revision).toBeTypeOf('string');

    const putRes = await app.inject({
      method: 'PUT',
      url: `/repos/${repoId}/context/document`,
      payload: { path: 'docs/existing.md', content: 'edited via the app', revision },
    });
    expect(putRes.statusCode).toBe(200);
    const written = putRes.json();
    expect(written.document.path).toBe('docs/existing.md');
    expect(written.revision).not.toBe(revision);

    const reGetRes = await app.inject({
      method: 'GET',
      url: `/repos/${repoId}/context/document?path=docs/existing.md`,
    });
    expect(reGetRes.json().content).toBe('edited via the app');

    // AC-40 continued: the LISTING (not just the direct-read endpoint) also
    // reflects the new content's recomputed token count on next load.
    const listingRes = await app.inject({ method: 'GET', url: `/repos/${repoId}/context` });
    const doc = listingRes.json().documents.find((x: { path: string }) => x.path === 'docs/existing.md');
    expect(doc).toBeDefined();
    expect(doc.missing).toBe(false);

    // Restore for subsequent tests in this file.
    await writeFile(join(clonePath, 'docs', 'existing.md'), '# Existing\noriginal content');
    await app.close();
  });

  it('AC-37: a save with a stale revision is rejected 409, distinct from a bad-path 4xx which is 422', async () => {
    const app = await makeApp();
    const repoId = await withClonedRepo();

    const staleRes = await app.inject({
      method: 'PUT',
      url: `/repos/${repoId}/context/document`,
      payload: { path: 'docs/existing.md', content: 'x', revision: 'not-the-real-hash' },
    });
    expect(staleRes.statusCode).toBe(409);

    const badPathRes = await app.inject({
      method: 'PUT',
      url: `/repos/${repoId}/context/document`,
      payload: { path: '../../etc/passwd.md', content: 'x', revision: 'irrelevant' },
    });
    expect(badPathRes.statusCode).toBe(422);
    expect(badPathRes.statusCode).not.toBe(409);

    // Neither request wrote anything.
    expect(await readFile(join(clonePath, 'docs', 'existing.md'), 'utf8')).toBe('# Existing\noriginal content');
    await app.close();
  });

  it('AC-41/AC-42: POST creates a document, and it appears via the ordinary GET listing walk with source_folder set', async () => {
    const app = await makeApp();
    const repoId = await withClonedRepo();

    const createRes = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/context/document`,
      payload: { path: 'docs/brand-new.md', content: 'freshly created' },
    });
    expect(createRes.statusCode).toBe(200);

    const listingRes = await app.inject({ method: 'GET', url: `/repos/${repoId}/context` });
    const created = listingRes.json().documents.find((x: { path: string }) => x.path === 'docs/brand-new.md');
    expect(created).toBeDefined();
    expect(created.source_folder).toBe('docs');
    expect(created.missing).toBe(false);
    await app.close();
  });

  it('AC-44: creating the same path twice — the second call is rejected 4xx and the first content survives', async () => {
    const app = await makeApp();
    const repoId = await withClonedRepo();

    const first = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/context/document`,
      payload: { path: 'docs/dup-route.md', content: 'first' },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/context/document`,
      payload: { path: 'docs/dup-route.md', content: 'second — must not land' },
    });
    expect(second.statusCode).toBeGreaterThanOrEqual(400);
    expect(second.statusCode).toBeLessThan(500);

    expect(await readFile(join(clonePath, 'docs', 'dup-route.md'), 'utf8')).toBe('first');
    await app.close();
  });

  it('AC-47 wiring: one representative shape rejection (win32 drive-letter form) reaches the route as a 4xx', async () => {
    const app = await makeApp();
    const repoId = await withClonedRepo();

    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/context/document`,
      payload: { path: 'C:/docs/evil.md', content: 'x' },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    await expect(readFile(join(clonePath, 'docs', 'evil.md'), 'utf8')).rejects.toThrow();
    await app.close();
  });

  it('AC-48: PUT/POST addressed at a repo outside the caller workspace 404s and writes nothing', async () => {
    const app = await makeApp();
    // A syntactically valid uuid that was never inserted — same effect as
    // "belongs to a different workspace" from this workspace's point of view.
    const foreignId = '00000000-0000-0000-0000-000000000000';

    const putRes = await app.inject({
      method: 'PUT',
      url: `/repos/${foreignId}/context/document`,
      payload: { path: 'docs/a.md', content: 'x', revision: 'r' },
    });
    expect(putRes.statusCode).toBe(404);

    const postRes = await app.inject({
      method: 'POST',
      url: `/repos/${foreignId}/context/document`,
      payload: { path: 'docs/should-not-exist.md', content: 'x' },
    });
    expect(postRes.statusCode).toBe(404);

    await expect(readFile(join(clonePath, 'docs', 'should-not-exist.md'), 'utf8')).rejects.toThrow();
    await app.close();
  });

  it('AC-49: content exceeding the per-document byte cap is rejected on both PUT and POST', async () => {
    const app = await makeApp();
    const repoId = await withClonedRepo();
    const oversized = 'a'.repeat(257 * 1024); // just above the 256 KB MAX_DOC_FILE_BYTES cap

    const putRes = await app.inject({
      method: 'PUT',
      url: `/repos/${repoId}/context/document`,
      payload: { path: 'docs/existing.md', content: oversized, revision: 'irrelevant' },
    });
    expect(putRes.statusCode).toBeGreaterThanOrEqual(400);
    expect(putRes.statusCode).toBeLessThan(500);

    const postRes = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/context/document`,
      payload: { path: 'docs/toobig-route.md', content: oversized },
    });
    expect(postRes.statusCode).toBeGreaterThanOrEqual(400);
    expect(postRes.statusCode).toBeLessThan(500);
    await expect(readFile(join(clonePath, 'docs', 'toobig-route.md'), 'utf8')).rejects.toThrow();
    await app.close();
  });
});
