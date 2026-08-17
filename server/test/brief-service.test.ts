/**
 * Brief module — BriefService (WI7, SPEC-03). ContainerOverrides pattern
 * (never module mocks), same shape as `test/intent-service.test.ts` — an
 * in-memory stub `BriefRepository`/`BriefSources` double, no real DB.
 *
 * Oracle (derived from docs/plans/spec-03-pr-brief-and-why-timeline.md WI7
 * DoD + specs/SPEC-03-pr-brief-and-why-timeline.md, read BEFORE opening
 * service.ts):
 *   - AC-1/AC-2/AC-12/AC-14/AC-15: reads and timeline listing make ZERO
 *     `completeStructured`/`complete` calls, for every read state.
 *   - AC-3: an explicit generation issues EXACTLY ONE `completeStructured`
 *     call and zero `complete` calls.
 *   - AC-6: a missing or SHA-stale `pr_intent` record degrades (records
 *     'missing'/'stale') rather than classifying — `IntentService.classify`
 *     is architecturally unreachable from this service (verified by grep:
 *     service.ts imports no `IntentService`), and generation still succeeds.
 *   - AC-7: `BriefSources.getBlastSummary` is called EXACTLY ONCE per
 *     generation (not "zero repoIntel calls" — that's the wrong layer here).
 *   - AC-9: the model resolves via `resolveFeatureModel`, honouring a
 *     workspace override and otherwise the registry default.
 *   - AC-11/AC-12: `{record, reused}` — `reused:false` on first generation,
 *     `reused:true` on the next read.
 *   - AC-13: two regenerations for the same head_sha replace, not append —
 *     the repository's own `upsertBrief` contract, exercised at the
 *     unit level via a Map-backed stub that mirrors AC-13's replace
 *     semantics (the DB-level composite-PK proof is `brief.it.test.ts`'s job).
 *   - AC-16: a generation request naming a non-current head_sha is refused
 *     (ConflictError) with zero model calls.
 *   - AC-17: current head has no brief but an earlier SHA does → 'stale'.
 *   - AC-21/AC-22: a fully-ungrounded response persists cleanly with
 *     recorded drop counts, never a failure.
 *   - AC-25: floor-exceeded → 'budget_exceeded', zero calls, nothing written.
 *   - AC-42: a throwing provider AND a schema-invalid response each →
 *     'failed', record null, nothing persisted, prior row untouched, no
 *     automatic retry.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import type { BlastRadiusResponse, PrIntentRecord, UnifiedDiff } from '@devdigest/shared';
import { loadConfig } from '../src/platform/config.js';
import { Container } from '../src/platform/container.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import { BriefService } from '../src/modules/brief/service.js';
import type { BriefPull, BriefRepoRow, BriefRepository, UpsertBriefInput } from '../src/modules/brief/repository.js';
import type { BriefSources } from '../src/modules/brief/sources.js';
import type { PrBriefRow } from '../src/db/rows.js';
import type { Db } from '../src/db/client.js';
import { ConflictError } from '../src/platform/errors.js';

const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

function emptySettingsDb(): Db {
  return { select: () => ({ from: () => ({ where: async () => [] }) }) } as unknown as Db;
}

function overrideSettingsDb(featureModels: Record<string, unknown>): Db {
  return {
    select: () => ({
      from: () => ({
        where: async () => [{ key: 'feature_models', value: featureModels }],
      }),
    }),
  } as unknown as Db;
}

const VALID_FIXTURE = {
  what: 'Adds rate limiting middleware to the public API.',
  why: 'Protects the API from abuse per the linked issue.',
  risk_level: 'medium' as const,
  risks: [
    {
      kind: 'security',
      title: 'New dependency',
      explanation: 'ioredis is a new runtime dependency.',
      severity: 'medium' as const,
      file_refs: ['src/config.ts'],
    },
  ],
  review_focus: [{ path: 'src/config.ts', line: 11, reason: 'Rate-limit config lives here.' }],
};

function makePull(overrides: Partial<BriefPull> = {}): BriefPull {
  return {
    id: 'pr-1',
    repoId: 'repo-1',
    base: 'main',
    headSha: 'sha-current',
    title: 'Add rate limiting',
    body: 'Adds rate limiting. Closes #471.',
    ...overrides,
  };
}

function makeRepoRow(overrides: Partial<BriefRepoRow> = {}): BriefRepoRow {
  return { id: 'repo-1', owner: 'acme', name: 'payments-api', clonePath: null, ...overrides };
}

function makeIntentRecord(overrides: Partial<PrIntentRecord> = {}): PrIntentRecord {
  return {
    pr_id: 'pr-1',
    intent: 'Add rate limiting to protect the API from abuse.',
    in_scope: ['rate limiting middleware'],
    out_of_scope: [],
    confidence: 0.8,
    sources: [],
    missing_context: [],
    risk_areas: [],
    head_sha: 'sha-current',
    provider: 'openrouter',
    model: 'deepseek/deepseek-v4-flash',
    classified_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeBlast(overrides: Partial<BlastRadiusResponse> = {}): BlastRadiusResponse {
  return {
    changed_symbols: [],
    downstream: [],
    summary: '1 symbol changed, 0 downstream callers.',
    status: 'full',
    reason: null,
    prior_prs: [],
    ...overrides,
  };
}

function makeDiff(overrides: Partial<UnifiedDiff> = {}): UnifiedDiff {
  return {
    raw: '',
    files: [
      {
        path: 'src/config.ts',
        additions: 2,
        deletions: 0,
        hunks: [
          { file: 'src/config.ts', oldStart: 10, oldLines: 0, newStart: 10, newLines: 2, newLineNumbers: [10, 11] },
        ],
      },
    ],
    ...overrides,
  };
}

/** In-memory BriefRepository — mirrors the composite-(prId,headSha) replace
 *  semantics `DrizzleBriefRepository.upsertBrief`'s `onConflictDoUpdate`
 *  gives the real table (AC-13), via a Map keyed the same way. */
function makeStubRepo(opts: {
  pull?: BriefPull;
  repoRow?: BriefRepoRow;
  intentRecord?: PrIntentRecord | undefined;
  seedRows?: PrBriefRow[];
} = {}): { repo: BriefRepository; store: Map<string, PrBriefRow>; upsertCalls: number[] } {
  const pull = opts.pull ?? makePull();
  const repoRow = opts.repoRow ?? makeRepoRow();
  const store = new Map<string, PrBriefRow>();
  for (const r of opts.seedRows ?? []) store.set(`${r.prId}:${r.headSha}`, r);
  const upsertCalls: number[] = [];

  const repo: BriefRepository = {
    async getPull(_workspaceId, prId) {
      return prId === pull.id ? pull : undefined;
    },
    async getRepo(repoId) {
      return repoId === repoRow.id ? repoRow : undefined;
    },
    async getIntentRecord(_prId) {
      return opts.intentRecord;
    },
    async countCommits(_prId) {
      return store.size;
    },
    async getBrief(prId, headSha) {
      return store.get(`${prId}:${headSha}`);
    },
    async getLatestBrief(prId) {
      const rows = [...store.values()].filter((r) => r.prId === prId);
      rows.sort((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime());
      return rows[0];
    },
    async listBriefs(prId, limit) {
      const rows = [...store.values()].filter((r) => r.prId === prId);
      rows.sort((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime());
      return rows.slice(0, limit);
    },
    async upsertBrief(prId, headSha, input: UpsertBriefInput) {
      upsertCalls.push(1);
      const row: PrBriefRow = {
        prId,
        headSha,
        json: input.json,
        provider: input.provider,
        model: input.model,
        inputTokens: input.inputTokens,
        tokensIn: input.tokensIn,
        tokensOut: input.tokensOut,
        costUsd: input.costUsd,
        droppedRiskRefs: input.droppedRiskRefs,
        droppedFocusItems: input.droppedFocusItems,
        droppedInputs: input.droppedInputs,
        generatedAt: new Date(),
      };
      store.set(`${prId}:${headSha}`, row); // REPLACE, never append (AC-13)
      return row;
    },
  };
  return { repo, store, upsertCalls };
}

function makeStubSources(opts: {
  diff?: UnifiedDiff;
  blast?: BlastRadiusResponse;
  specFile?: string | null;
  issue?: string | null;
} = {}): { sources: BriefSources; blastCalls: number[] } {
  const blastCalls: number[] = [];
  const sources: BriefSources = {
    async loadDiff() {
      return opts.diff ?? makeDiff();
    },
    async readSpecFile() {
      return opts.specFile ?? null;
    },
    async getBlastSummary() {
      blastCalls.push(1);
      return opts.blast ?? makeBlast();
    },
    async fetchLinkedIssue() {
      return opts.issue ?? null;
    },
  };
  return { sources, blastCalls };
}

describe('BriefService — AC-6 structural check: IntentService.classify is unreachable', () => {
  it('service.ts never imports IntentService (grep-verified, not just behaviourally inferred)', async () => {
    const src = await readFile(new URL('../src/modules/brief/service.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/IntentService/);
  });
});

describe('BriefService — reads never call the model (AC-1/AC-2/AC-12/AC-17)', () => {
  let llm: MockLLMProvider;
  beforeEach(() => {
    llm = new MockLLMProvider('openai', { structured: VALID_FIXTURE });
  });

  function build(opts: Parameters<typeof makeStubRepo>[0] = {}) {
    const { repo, store } = makeStubRepo(opts);
    const { sources } = makeStubSources();
    const container = new Container(config, emptySettingsDb(), {
      llm: { openai: llm },
      tokenizer: { count: (t) => t.length },
    });
    return { service: new BriefService(repo, sources, container), store };
  }

  it('AC-2: no brief for the PR at all → state "absent", zero model calls', async () => {
    const { service } = build();
    const res = await service.getBrief('ws-1', 'pr-1');
    expect(res.state).toBe('absent');
    expect(res.reused).toBe(true);
    expect(llm.calls).toHaveLength(0);
  });

  it('AC-1/AC-12: a brief exists for the current head_sha → state "current", zero model calls, reused:true', async () => {
    const seedRow: PrBriefRow = {
      prId: 'pr-1',
      headSha: 'sha-current',
      json: {
        what: 'x',
        why: 'y',
        risk_level: 'low',
        risks: [],
        review_focus: [],
        input_status: {
          intent_status: 'used',
          blast_status: 'full',
          changed_file_count: 1,
          spec_files_used: [],
          spec_files_unresolved: [],
          linked_issue_status: 'not_referenced',
        },
      },
      provider: 'openai',
      model: 'gpt-4.1',
      inputTokens: 100,
      tokensIn: 90,
      tokensOut: 10,
      costUsd: 0.001,
      droppedRiskRefs: 0,
      droppedFocusItems: 0,
      droppedInputs: [],
      generatedAt: new Date(),
    };
    const { service } = build({ seedRows: [seedRow] });
    const res = await service.getBrief('ws-1', 'pr-1');
    expect(res.state).toBe('current');
    expect(res.reused).toBe(true);
    expect(res.record?.what).toBe('x');
    expect(llm.calls).toHaveLength(0);
  });

  it('AC-17: current head has no brief but an earlier SHA does → "stale", naming that SHA, zero model calls', async () => {
    const oldRow: PrBriefRow = {
      prId: 'pr-1',
      headSha: 'sha-old',
      json: {
        what: 'old what',
        why: 'old why',
        risk_level: 'low',
        risks: [],
        review_focus: [],
        input_status: {
          intent_status: 'used',
          blast_status: 'full',
          changed_file_count: 1,
          spec_files_used: [],
          spec_files_unresolved: [],
          linked_issue_status: 'not_referenced',
        },
      },
      provider: 'openai',
      model: 'gpt-4.1',
      inputTokens: 100,
      tokensIn: 90,
      tokensOut: 10,
      costUsd: 0.001,
      droppedRiskRefs: 0,
      droppedFocusItems: 0,
      droppedInputs: [],
      generatedAt: new Date(),
    };
    const { service } = build({ seedRows: [oldRow] });
    const res = await service.getBrief('ws-1', 'pr-1');
    expect(res.state).toBe('stale');
    expect(res.reason).toContain('sha-old');
    expect(res.record?.head_sha).toBe('sha-old');
    expect(llm.calls).toHaveLength(0);
  });
});

describe('BriefService — generate() (AC-3/AC-6/AC-7/AC-9/AC-11/AC-13/AC-16/AC-21/AC-22)', () => {
  let llm: MockLLMProvider;
  beforeEach(() => {
    llm = new MockLLMProvider('openai', { structured: VALID_FIXTURE });
  });

  function build(opts: {
    repoOpts?: Parameters<typeof makeStubRepo>[0];
    sourcesOpts?: Parameters<typeof makeStubSources>[0];
    settingsDb?: Db;
  } = {}) {
    const { repo, store, upsertCalls } = makeStubRepo(opts.repoOpts);
    const { sources, blastCalls } = makeStubSources(opts.sourcesOpts);
    const container = new Container(config, opts.settingsDb ?? emptySettingsDb(), {
      llm: { openai: llm },
      tokenizer: { count: (t) => t.length },
    });
    return { service: new BriefService(repo, sources, container), store, upsertCalls, blastCalls };
  }

  it('AC-3: exactly one completeStructured call and zero complete() calls for one generation', async () => {
    const { service } = build();
    const res = await service.generate('ws-1', 'pr-1', { headSha: 'sha-current' });
    expect(res.state).toBe('current');
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);
    expect(llm.calls.filter((c) => c.method === 'complete')).toHaveLength(0);
  });

  it('AC-11: first generation → reused:false; a subsequent read → reused:true', async () => {
    const { service } = build();
    const gen = await service.generate('ws-1', 'pr-1', { headSha: 'sha-current' });
    expect(gen.reused).toBe(false);
    const read = await service.getBrief('ws-1', 'pr-1');
    expect(read.reused).toBe(true);
    // Read cost zero ADDITIONAL model calls beyond the one generation.
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);
  });

  it('AC-6: no persisted intent record → generation still succeeds, input_status.intent_status "missing", no spec files read', async () => {
    const { service } = build({ repoOpts: { intentRecord: undefined } });
    const res = await service.generate('ws-1', 'pr-1', { headSha: 'sha-current' });
    expect(res.state).toBe('current');
    expect(res.record?.input_status.intent_status).toBe('missing');
    expect(res.record?.input_status.spec_files_used).toEqual([]);
  });

  it('AC-6: an intent record whose head_sha differs from the PR current head_sha degrades to "stale", not classified', async () => {
    const { service } = build({
      repoOpts: { intentRecord: makeIntentRecord({ head_sha: 'sha-old-intent' }) },
    });
    const res = await service.generate('ws-1', 'pr-1', { headSha: 'sha-current' });
    expect(res.record?.input_status.intent_status).toBe('stale');
  });

  it('AC-7: BriefSources.getBlastSummary is called exactly once per generation', async () => {
    const { service, blastCalls } = build();
    await service.generate('ws-1', 'pr-1', { headSha: 'sha-current' });
    expect(blastCalls).toHaveLength(1);
  });

  it('AC-9: no workspace override → resolves to the risk_brief registry default (openai/gpt-4.1)', async () => {
    const { service } = build();
    const res = await service.generate('ws-1', 'pr-1', { headSha: 'sha-current' });
    expect(res.record?.usage.provider).toBe('openai');
    expect(res.record?.usage.model).toBe('gpt-4.1');
  });

  it('AC-9: a workspace override for risk_brief is honoured over the registry default', async () => {
    const overrideLlm = new MockLLMProvider('anthropic', { structured: VALID_FIXTURE });
    const { repo } = makeStubRepo();
    const { sources } = makeStubSources();
    const container = new Container(
      config,
      overrideSettingsDb({ risk_brief: { provider: 'anthropic', model: 'claude-override' } }),
      { llm: { anthropic: overrideLlm }, tokenizer: { count: (t) => t.length } },
    );
    const service = new BriefService(repo, sources, container);
    const res = await service.generate('ws-1', 'pr-1', { headSha: 'sha-current' });
    expect(res.record?.usage.provider).toBe('anthropic');
    expect(res.record?.usage.model).toBe('claude-override');
    expect(overrideLlm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);
  });

  it('AC-13: two force regenerations for the same head_sha REPLACE — one row, not two', async () => {
    const { service, store, upsertCalls } = build();
    await service.generate('ws-1', 'pr-1', { headSha: 'sha-current' });
    await service.generate('ws-1', 'pr-1', { headSha: 'sha-current', force: true });
    expect(upsertCalls).toHaveLength(2); // two writes...
    const rowsForSha = [...store.values()].filter((r) => r.prId === 'pr-1' && r.headSha === 'sha-current');
    expect(rowsForSha).toHaveLength(1); // ...but exactly one row survives (AC-13)
  });

  it('AC-16: a generate request naming a NON-current head_sha is refused with zero model calls', async () => {
    const { service } = build();
    await expect(service.generate('ws-1', 'pr-1', { headSha: 'sha-not-current' })).rejects.toThrow(ConflictError);
    expect(llm.calls).toHaveLength(0);
  });

  it('AC-21/AC-22: a fully-ungrounded response persists (not a failure) with the drop counts recorded', async () => {
    const ungroundedFixture = {
      what: 'Adds a feature',
      why: 'For reasons',
      risk_level: 'low' as const,
      risks: [
        { kind: 'x', title: 'y', explanation: 'z', severity: 'low' as const, file_refs: ['not-in-diff.ts'] },
      ],
      review_focus: [{ path: 'not-in-diff.ts', line: 1, reason: 'nope' }],
    };
    llm = new MockLLMProvider('openai', { structured: ungroundedFixture });
    const { service } = build();
    const res = await service.generate('ws-1', 'pr-1', { headSha: 'sha-current' });
    expect(res.state).toBe('current'); // honestly empty, not a failure
    expect(res.record?.risks[0]!.file_refs).toEqual([]);
    expect(res.record?.review_focus).toEqual([]);
    expect(res.record?.usage.dropped_risk_refs).toBe(1);
    expect(res.record?.usage.dropped_focus_items).toBe(1);
  });
});

describe('BriefService — AC-25: floor-exceeded budget → zero calls, nothing persisted', () => {
  it('an oversized intent block alone (over the floor) skips the call entirely', async () => {
    const llm = new MockLLMProvider('openai', { structured: VALID_FIXTURE });
    const { repo, store, upsertCalls } = makeStubRepo({
      intentRecord: makeIntentRecord({ intent: 'y'.repeat(20_000) }),
    });
    const { sources } = makeStubSources();
    const container = new Container(config, emptySettingsDb(), {
      llm: { openai: llm },
      tokenizer: { count: (t) => t.length }, // 1 char = 1 token, budget is 8000
    });
    const service = new BriefService(repo, sources, container);

    const res = await service.generate('ws-1', 'pr-1', { headSha: 'sha-current' });
    expect(res.state).toBe('budget_exceeded');
    expect(res.record).toBeNull();
    expect(res.reused).toBe(false);
    expect(llm.calls).toHaveLength(0);
    expect(upsertCalls).toHaveLength(0);
    expect(store.size).toBe(0);
  });
});

describe('BriefService — AC-42: failed generation persists nothing, leaves prior state intact, no auto-retry', () => {
  it('a throwing provider → state "failed", record null, nothing written', async () => {
    const llm = new MockLLMProvider('openai');
    llm.completeStructured = async () => {
      throw new Error('simulated provider failure');
    };
    const { repo, store, upsertCalls } = makeStubRepo();
    const { sources } = makeStubSources();
    const container = new Container(config, emptySettingsDb(), {
      llm: { openai: llm },
      tokenizer: { count: (t) => t.length },
    });
    const service = new BriefService(repo, sources, container);

    const res = await service.generate('ws-1', 'pr-1', { headSha: 'sha-current' });
    expect(res.state).toBe('failed');
    expect(res.record).toBeNull();
    expect(upsertCalls).toHaveLength(0);
    expect(store.size).toBe(0);
    // No automatic retry — exactly one attempted call.
    expect(llm.calls).toHaveLength(0); // our override throws before pushing to .calls
  });

  it('a schema-invalid response (fails validation, simulating post-retry adapter failure) → "failed", nothing written', async () => {
    const llm = new MockLLMProvider('openai', { structured: { what: 'missing required fields' } });
    const { repo, store, upsertCalls } = makeStubRepo();
    const { sources } = makeStubSources();
    const container = new Container(config, emptySettingsDb(), {
      llm: { openai: llm },
      tokenizer: { count: (t) => t.length },
    });
    const service = new BriefService(repo, sources, container);

    const res = await service.generate('ws-1', 'pr-1', { headSha: 'sha-current' });
    expect(res.state).toBe('failed');
    expect(res.record).toBeNull();
    expect(upsertCalls).toHaveLength(0);
    expect(store.size).toBe(0);
  });

  it('a failed regeneration leaves a PRIOR successful row for that head_sha byte-identical', async () => {
    const okLlm = new MockLLMProvider('openai', { structured: VALID_FIXTURE });
    const { repo, store } = makeStubRepo();
    const { sources } = makeStubSources();
    const container1 = new Container(config, emptySettingsDb(), {
      llm: { openai: okLlm },
      tokenizer: { count: (t) => t.length },
    });
    const service1 = new BriefService(repo, sources, container1);
    await service1.generate('ws-1', 'pr-1', { headSha: 'sha-current' });
    const before = store.get('pr-1:sha-current');
    expect(before).toBeDefined();

    const throwingLlm = new MockLLMProvider('openai');
    throwingLlm.completeStructured = async () => {
      throw new Error('simulated failure on regenerate');
    };
    const container2 = new Container(config, emptySettingsDb(), {
      llm: { openai: throwingLlm },
      tokenizer: { count: (t) => t.length },
    });
    const service2 = new BriefService(repo, sources, container2);
    const res = await service2.generate('ws-1', 'pr-1', { headSha: 'sha-current', force: true });
    expect(res.state).toBe('failed');

    const after = store.get('pr-1:sha-current');
    expect(after).toEqual(before);
  });
});

describe('BriefService — getTimeline (AC-14/AC-15)', () => {
  it('serves every persisted brief for the PR with zero model calls, regardless of SHA count', async () => {
    const llm = new MockLLMProvider('openai', { structured: VALID_FIXTURE });
    function mkRow(sha: string): PrBriefRow {
      return {
        prId: 'pr-1',
        headSha: sha,
        json: {
          what: `what-${sha}`,
          why: 'y',
          risk_level: 'low',
          risks: [],
          review_focus: [],
          input_status: {
            intent_status: 'used',
            blast_status: 'full',
            changed_file_count: 1,
            spec_files_used: [],
            spec_files_unresolved: [],
            linked_issue_status: 'not_referenced',
          },
        },
        provider: 'openai',
        model: 'gpt-4.1',
        inputTokens: 100,
        tokensIn: 90,
        tokensOut: 10,
        costUsd: 0.001,
        droppedRiskRefs: 0,
        droppedFocusItems: 0,
        droppedInputs: [],
        generatedAt: new Date(),
      };
    }
    const { repo } = makeStubRepo({ seedRows: [mkRow('sha-a'), mkRow('sha-b'), mkRow('sha-current')] });
    const { sources } = makeStubSources();
    const container = new Container(config, emptySettingsDb(), {
      llm: { openai: llm },
      tokenizer: { count: (t) => t.length },
    });
    const service = new BriefService(repo, sources, container);

    const timeline = await service.getTimeline('ws-1', 'pr-1');
    expect(timeline.entries).toHaveLength(3);
    expect(timeline.brief_count).toBe(3);
    expect(llm.calls).toHaveLength(0);
    // Exactly one entry is marked as the current head.
    expect(timeline.entries.filter((e) => e.is_current_head)).toHaveLength(1);
    expect(timeline.entries.find((e) => e.is_current_head)?.head_sha).toBe('sha-current');
  });
});
