/**
 * `POST /agents/:id/export-ci` with a hand-edited `workflow_override` —
 * SPEC-05 (`specs/SPEC-05-multi-agent-ci-per-repo.md`) AC-24, exercised
 * through the REAL Install route so the "refuses, commits nothing" A10
 * fail-closed guarantee is proven end to end, not just at the pure
 * `validateWorkflowOverride` unit level (see `test/ci-workflow-validate.test.ts`
 * for the exhaustive per-violation unit coverage).
 *
 * Oracle: AC-24 ("a hand-edited override must not be able to aim one
 * agent's workflow at another agent's namespace or another agent's ingest
 * secret … it shall refuse, naming the violated invariant, and shall commit
 * nothing") derived from the spec text BEFORE reading `service.ts#install`'s
 * own call site for `validateWorkflowOverride`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { stringify as stringifyYaml } from 'yaml';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitHubClient } from '../src/adapters/mocks.js';
import { buildWorkflow } from '../src/modules/ci/workflow.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[ci-workflow-override] Docker not available — skipping integration tests.');
}

d('POST /agents/:id/export-ci with workflow_override — AC-24 fail-closed, zero GitHub writes', () => {
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
    return `acme/override-repo-${repoSeq++}-${Date.now()}`;
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

  async function installWith(
    app: Awaited<ReturnType<typeof buildApp>>,
    agentId: string,
    repo: string,
    workflowOverride: string,
  ) {
    return app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: {
        repo,
        target: 'gha',
        post_as: 'github_review',
        triggers: ['opened', 'synchronize', 'reopened'],
        base: 'main',
        ingest_url: 'https://studio.example.com/ci/ingest',
        workflow_override: workflowOverride,
      },
    });
  }

  /** A namespaced-agent-shaped workflow for namespace "override-test-agent"
   *  (this agent's own name slugifies to that) — mutated per test to attempt
   *  aiming it at something foreign. */
  function baseWorkflowObject() {
    const doc = buildWorkflow({
      triggers: ['opened', 'synchronize', 'reopened'],
      postAs: 'github_review',
      ingestUrl: 'https://studio.example.com/ci/ingest',
      namespace: 'override-test-agent',
    });
    return doc.toJSON() as any;
  }

  it('a workflow_override with a FOREIGN DEVDIGEST_DIR is refused (422) and commits nothing', async () => {
    const github = new MockGitHubClient();
    const app = await makeApp(github);
    const repo = freshRepo();
    const agentId = await createAgent(app, 'Override Test Agent');

    const wf = baseWorkflowObject();
    const reviewStep = wf.jobs.review.steps.find((s: any) => s.id === 'review');
    reviewStep.env.DEVDIGEST_DIR = '.devdigest/some-other-installation';

    const res = await installWith(app, agentId, repo, stringifyYaml(wf));
    expect(res.statusCode).toBe(422);
    expect(github.committed).toHaveLength(0);

    await app.close();
  });

  it('a workflow_override with DEVDIGEST_DIR: ".." is refused (422) and commits nothing', async () => {
    const github = new MockGitHubClient();
    const app = await makeApp(github);
    const repo = freshRepo();
    const agentId = await createAgent(app, 'Override Traversal Agent');

    const wf = baseWorkflowObject();
    const reviewStep = wf.jobs.review.steps.find((s: any) => s.id === 'review');
    reviewStep.env.DEVDIGEST_DIR = '..';

    const res = await installWith(app, agentId, repo, stringifyYaml(wf));
    expect(res.statusCode).toBe(422);
    expect(github.committed).toHaveLength(0);

    await app.close();
  });

  it('a workflow_override with DEVDIGEST_DIR declared at JOB level (not the review step) is refused (422) and commits nothing', async () => {
    const github = new MockGitHubClient();
    const app = await makeApp(github);
    const repo = freshRepo();
    const agentId = await createAgent(app, 'Override Job Level Agent');

    const wf = baseWorkflowObject();
    wf.jobs.review.env = { DEVDIGEST_DIR: '.devdigest/override-job-level-agent' };

    const res = await installWith(app, agentId, repo, stringifyYaml(wf));
    expect(res.statusCode).toBe(422);
    expect(github.committed).toHaveLength(0);

    await app.close();
  });

  it("a workflow_override referencing ANOTHER installation's ingest secret is refused (422) and commits nothing", async () => {
    const github = new MockGitHubClient();
    const app = await makeApp(github);
    const repo = freshRepo();
    const agentId = await createAgent(app, 'Override Foreign Secret Agent');

    const wf = baseWorkflowObject();
    const reportStep = wf.jobs.review.steps.find((s: any) => s.name === 'Report result to DevDigest');
    reportStep.env.INGEST_TOKEN = '${{ secrets.DEVDIGEST_INGEST_TOKEN_SOME_OTHER_AGENT }}';

    const res = await installWith(app, agentId, repo, stringifyYaml(wf));
    expect(res.statusCode).toBe(422);
    expect(github.committed).toHaveLength(0);

    await app.close();
  });

  it('a VALID override (matching this installation\'s own resolved namespace) is accepted and commits normally', async () => {
    const github = new MockGitHubClient();
    const app = await makeApp(github);
    const repo = freshRepo();
    const agentId = await createAgent(app, 'Override Test Agent');

    const res = await installWith(app, agentId, repo, stringifyYaml(baseWorkflowObject()));
    expect(res.statusCode).toBe(200);
    expect(github.committed).toHaveLength(1);

    await app.close();
  });
});
