/**
 * `POST /agents/:id/export-ci/preview` (SPEC-05 AC-32, AC-33's verify
 * clauses) — fix-loop iteration 1. `plan-verifier` found zero test coverage
 * for this route: no test exercised the preview route, the `CiExportPreview`
 * schema, or `routes.ts`'s `ingest_secret_name` field.
 *
 * Oracle: `specs/SPEC-05-multi-agent-ci-per-repo.md` AC-32 — "Preview step
 * shall show the namespaced paths the export will actually create — the same
 * bytes and the same paths Install commits" — derived from the spec text
 * BEFORE reading `service.ts#generateFiles`/`install` beyond their exported
 * signatures. Follows `test/eval-read-apis.it.test.ts`'s harness shape
 * (`startPg`/`dockerAvailable`, `buildApp`) and
 * `test/ci-workflow-override.it.test.ts`'s `MockGitHubClient` use to capture
 * what Install actually commits.
 *
 * AC-33 ("two agents' runs on one repo") needs no new test here — the CI Runs
 * page/its own tests are untouched by this feature (confirmed by inspection,
 * not re-tested redundantly here).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitHubClient } from '../src/adapters/mocks.js';
import { RUNNER_PATH } from '../src/modules/ci/constants.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[ci-export-preview] Docker not available — skipping integration tests.');
}

d('POST /agents/:id/export-ci/preview — parity with what Install actually commits (AC-32)', () => {
  let pg: PgFixture;
  let repoSeq = 0;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp(github: MockGitHubClient) {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({ config, db: pg.handle.db, overrides: { github } });
  }

  function freshRepo(): string {
    return `acme/preview-parity-repo-${repoSeq++}-${Date.now()}`;
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

  function exportBody(repo: string) {
    return {
      repo,
      target: 'gha',
      post_as: 'github_review',
      triggers: ['opened', 'synchronize', 'reopened'],
      base: 'main',
      ingest_url: 'https://studio.example.com/ci/ingest',
    };
  }

  it('the previewed path set equals the payload Install submits, and non-placeholder bytes match exactly', async () => {
    const github = new MockGitHubClient();
    const app = await makeApp(github);
    const repo = freshRepo();
    const agentId = await createAgent(app, 'Preview Parity Agent');

    // Preview first — zero side effects, resolves the SAME candidate layout
    // Install will (no existing installation on this fresh repo yet, so
    // `resolveLayout` derives an identical namespace both times).
    const previewRes = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci/preview`,
      payload: exportBody(repo),
    });
    expect(previewRes.statusCode).toBe(200);
    const preview = previewRes.json();

    const installRes = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: exportBody(repo),
    });
    expect(installRes.statusCode).toBe(200);
    const install = installRes.json();

    // What Install ACTUALLY committed to GitHub — the ground truth AC-32
    // promises Preview matches, not just Install's own response payload.
    expect(github.committed).toHaveLength(1);
    const committedFiles = github.committed[0]!.files;

    // Same path SET, both directions — no path Preview shows is absent from
    // the commit, and no path is committed that Preview never showed.
    const previewPaths = preview.files.map((f: { path: string }) => f.path).sort();
    const committedPaths = committedFiles.map((f: { path: string }) => f.path).sort();
    expect(previewPaths).toEqual(committedPaths);
    expect(previewPaths.length).toBeGreaterThan(0);

    // Byte-for-byte content parity for every path EXCEPT the runner bundle —
    // that one entry is deliberately a placeholder in Preview
    // (`preview_omitted: true`, Q-3) and the real bundle bytes only at
    // Install; every other generated file must be byte-identical.
    for (const previewFile of preview.files as { path: string; contents: string; preview_omitted: boolean }[]) {
      const committedFile = committedFiles.find((f: { path: string }) => f.path === previewFile.path);
      expect(committedFile).toBeDefined();
      if (previewFile.path === RUNNER_PATH) {
        expect(previewFile.preview_omitted).toBe(true);
      } else {
        expect(previewFile.preview_omitted).toBe(false);
        expect(previewFile.contents).toBe(committedFile!.contents);
      }
    }

    // `ingest_secret_name` (routes.ts:105) — the same name both the Preview
    // response and the persisted installation record.
    expect(preview.ingest_secret_name).toBe(install.installation.ingest_secret_name);

    await app.close();
  });

  it('Preview itself commits nothing (zero side effects) regardless of parity', async () => {
    const github = new MockGitHubClient();
    const app = await makeApp(github);
    const repo = freshRepo();
    const agentId = await createAgent(app, 'Preview No Side Effects Agent');

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci/preview`,
      payload: exportBody(repo),
    });
    expect(res.statusCode).toBe(200);
    expect(github.committed).toHaveLength(0);
    expect(github.openedPrs).toHaveLength(0);

    await app.close();
  });
});
