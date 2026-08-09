/**
 * Intent Layer — IntentService with ContainerOverrides (never module mocks)
 * (docs/plans/intent-layer.md work item 4 / Test plan).
 *
 * - unresolved external/linked refs → resolved:false + missing_context +
 *   capped confidence; classifier messages do not invent fetched content
 * - head-SHA cache hit → no LLM call
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { loadConfig } from '../src/platform/config.js';
import { Container } from '../src/platform/container.js';
import { MockLLMProvider, MockGitHubClient } from '../src/adapters/mocks.js';
import { IntentService } from '../src/modules/reviews/intent-service.js';
import type { ReviewRepository } from '../src/modules/reviews/repository.js';
import type { UpsertIntentInput } from '../src/modules/reviews/repository/pull.repo.js';
import type { PullRow } from '../src/db/rows.js';
import type { PrIntentRecord } from '@devdigest/shared';
import type { Db } from '../src/db/client.js';
import type { RepoRow } from '../src/modules/reviews/intent-service.js';

const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** drizzle chain used by resolveFeatureModel — empty settings → registry default. */
function emptySettingsDb(): Db {
  return {
    select: () => ({
      from: () => ({
        where: async () => [],
      }),
    }),
  } as unknown as Db;
}

const INTENT_FIXTURE = {
  intent: 'Add rate limiting to protect the API from abuse.',
  in_scope: ['rate limiting middleware'],
  out_of_scope: ['auth rewrite'],
  confidence: 0.9,
  missing_context: [],
  risk_areas: ['New dependency: ioredis', 'Auth surface touched'],
};

function makePull(overrides: Partial<PullRow> = {}): PullRow {
  return {
    id: 'pr-1',
    workspaceId: 'ws-1',
    repoId: 'repo-1',
    number: 482,
    title: 'Add rate limiting',
    author: 'marisa.koch',
    branch: 'feat/rl',
    base: 'main',
    headSha: 'abc1234',
    lastReviewedSha: null,
    additions: 1,
    deletions: 0,
    filesCount: 1,
    status: 'needs_review',
    body: 'See https://jira.example/ABC-1 for context.',
    openedAt: null,
    updatedAt: null,
    createdAt: new Date(),
    ...overrides,
  } as PullRow;
}

function makeRepo(overrides: Partial<RepoRow> = {}): RepoRow {
  return {
    id: 'repo-1',
    workspaceId: 'ws-1',
    owner: 'acme',
    name: 'payments-api',
    fullName: 'acme/payments-api',
    defaultBranch: 'main',
    clonePath: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as RepoRow;
}

function makeRepoStub(opts: {
  stored?: PrIntentRecord | undefined;
  pull?: PullRow;
  repo?: RepoRow;
}): { repo: ReviewRepository; getStored: () => PrIntentRecord | undefined } {
  let stored = opts.stored;
  const pull = opts.pull ?? makePull();
  const repoRow = opts.repo ?? makeRepo();

  const repo = {
    getIntentRecord: async (_prId: string) => stored,
    upsertIntent: async (prId: string, intent: UpsertIntentInput) => {
      stored = {
        pr_id: prId,
        intent: intent.intent,
        in_scope: intent.in_scope,
        out_of_scope: intent.out_of_scope,
        confidence: intent.confidence ?? null,
        sources: intent.sources,
        missing_context: intent.missing_context,
        risk_areas: intent.risk_areas,
        head_sha: intent.headSha,
        provider: intent.provider,
        model: intent.model,
        classified_at: new Date().toISOString(),
      };
    },
    getPull: async () => pull,
    getRepo: async () => repoRow,
    getPrFiles: async () => [],
  } as unknown as ReviewRepository;

  return {
    repo,
    getStored: () => stored,
  };
}

describe('IntentService — ContainerOverrides', () => {
  let llm: MockLLMProvider;

  beforeEach(() => {
    llm = new MockLLMProvider('openai', { structured: INTENT_FIXTURE });
  });

  function buildService(opts: {
    stored?: PrIntentRecord;
    pull?: PullRow;
    repo?: RepoRow;
    github?: MockGitHubClient;
  }) {
    const stub = makeRepoStub(opts);
    const container = new Container(config, emptySettingsDb(), {
      llm: { openrouter: llm },
      github: opts.github ?? new MockGitHubClient(),
      tokenizer: { count: () => 42 },
    });
    return { service: new IntentService(stub.repo, container), stub, container };
  }

  it('unresolved external URL → resolved:false, missing_context, capped confidence, no fabricated fetch content', async () => {
    const pull = makePull({
      body: 'See https://jira.example/ABC-1 for the ticket. Also specs/missing.md.',
    });
    const { service, stub } = buildService({ pull, repo: makeRepo({ clonePath: null }) });

    const record = await service.classify('ws-1', pull, makeRepo({ clonePath: null }), {
      files: [
        {
          path: 'src/config.ts',
          additions: 1,
          deletions: 0,
          hunks: [{ oldStart: 10, oldLines: 3, newStart: 10, newLines: 4 }],
        },
      ],
    });

    const external = record.sources.find((s) => s.kind === 'external_link');
    expect(external).toMatchObject({
      kind: 'external_link',
      ref: 'https://jira.example/ABC-1',
      resolved: false,
    });

    const missingSpec = record.sources.find((s) => s.kind === 'spec_file');
    expect(missingSpec).toMatchObject({
      kind: 'spec_file',
      ref: 'specs/missing.md',
      resolved: false,
    });

    expect(record.missing_context.some((m) => m.includes('https://jira.example/ABC-1'))).toBe(true);
    expect(record.missing_context.some((m) => m.includes('specs/missing.md'))).toBe(true);
    // Model reported 0.9 — must be capped because unresolved sources exist.
    expect(record.confidence).toBe(0.5);
    // Pass-through of model text — server never invents a summary of the
    // unresolved Jira/spec content.
    expect(record.intent).toBe(INTENT_FIXTURE.intent);
    expect(record.in_scope).toEqual(INTENT_FIXTURE.in_scope);

    // Classifier messages must not contain a fabricated "fetched" body for
    // the unresolved URL / missing spec (no Linked-issue / Referenced-spec
    // sections invented for them).
    const call = llm.calls.find((c) => c.method === 'completeStructured');
    expect(call).toBeTruthy();
    const messages = (call!.req as { messages: { role: string; content: string }[] }).messages;
    const user = messages.find((m) => m.role === 'user')!.content;
    expect(user).not.toContain('## Referenced spec: specs/missing.md');
    expect(user).not.toMatch(/## Linked issue/);
    // The URL may appear inside the PR description (author text) — that is
    // data, not a fabricated fetch. Assert we did not invent page content.
    expect(user).not.toContain('fabricated jira body');
    expect(stub.getStored()?.confidence).toBe(0.5);
  });

  it('unresolved linked issue (GitHub getIssue fails) → resolved:false + missing_context + cap', async () => {
    const github = new MockGitHubClient();
    github.getIssue = async () => {
      throw new Error('Not Found');
    };
    const pull = makePull({ body: 'Closes #471.' });
    const { service } = buildService({ pull, github });

    const record = await service.classify('ws-1', pull, makeRepo(), { files: [] });

    expect(record.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'linked_issue', ref: '#471', resolved: false }),
      ]),
    );
    expect(record.missing_context.some((m) => m.includes('#471'))).toBe(true);
    expect(record.confidence).toBe(0.5);

    const call = llm.calls.find((c) => c.method === 'completeStructured');
    const user = (call!.req as { messages: { role: string; content: string }[] }).messages.find(
      (m) => m.role === 'user',
    )!.content;
    // Must not invent issue body content when fetch failed.
    expect(user).not.toContain('## Linked issue #471');
    expect(user).not.toContain('mock issue');
  });

  it('classify() persists the classifier\'s risk_areas via upsertIntent and round-trips them through getIntentRecord (WI10)', async () => {
    const pull = makePull({ body: 'Plain description with no links.' });
    const { service, stub } = buildService({ pull, repo: makeRepo() });

    const record = await service.classify('ws-1', pull, makeRepo(), { files: [] });

    expect(record.risk_areas).toEqual(INTENT_FIXTURE.risk_areas);
    // Persisted row (repository boundary), not just the in-memory return value.
    expect(stub.getStored()?.risk_areas).toEqual(INTENT_FIXTURE.risk_areas);
  });

  it('classify() defaults risk_areas to [] when the model omits it — never fabricated', async () => {
    llm = new MockLLMProvider('openai', {
      structured: { ...INTENT_FIXTURE, risk_areas: undefined },
    });
    const pull = makePull({ body: 'Plain description with no links.' });
    const { service } = buildService({ pull, repo: makeRepo() });

    const record = await service.classify('ws-1', pull, makeRepo(), { files: [] });

    expect(record.risk_areas).toEqual([]);
  });

  it('getOrClassify reuses persisted intent on head-SHA match — no LLM call', async () => {
    const pull = makePull({ headSha: 'abc1234' });
    const stored: PrIntentRecord = {
      pr_id: 'pr-1',
      intent: 'Cached intent',
      in_scope: ['cached'],
      out_of_scope: [],
      confidence: 0.7,
      sources: [{ kind: 'pr_title', ref: null, resolved: true }],
      missing_context: [],
      risk_areas: ['cached risk'],
      head_sha: 'abc1234',
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
      classified_at: new Date().toISOString(),
    };
    const { service } = buildService({ pull, stored });

    const { record, reused } = await service.getOrClassify('ws-1', pull, makeRepo(), { files: [] });

    expect(reused).toBe(true);
    expect(record.intent).toBe('Cached intent');
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(0);
  });

  it('getOrClassify classifies when stored head_sha differs', async () => {
    const pull = makePull({ headSha: 'newsha99' });
    const stored: PrIntentRecord = {
      pr_id: 'pr-1',
      intent: 'Stale intent',
      in_scope: [],
      out_of_scope: [],
      confidence: 0.7,
      sources: [],
      missing_context: [],
      risk_areas: [],
      head_sha: 'oldsha00',
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
      classified_at: new Date().toISOString(),
    };
    const { service } = buildService({
      pull,
      stored,
      // no external refs so confidence is not capped — isolate the cache-miss path
      repo: makeRepo(),
    });
    // Override pull body to avoid unresolved refs muddying the assertion.
    pull.body = 'Plain description with no links.';

    const { record, reused } = await service.getOrClassify('ws-1', pull, makeRepo(), { files: [] });

    expect(reused).toBe(false);
    expect(record.intent).toBe(INTENT_FIXTURE.intent);
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);
    expect(record.head_sha).toBe('newsha99');
  });
});
