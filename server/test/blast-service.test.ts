/**
 * BlastService with a fake BlastRepository + a fake RepoIntel injected via
 * `ContainerOverrides.repoIntel` (no DB / Docker). Modeled on
 * `test/smart-diff-service.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { BlastRadiusResponse } from '@devdigest/shared';
import type { Db } from '../src/db/client.js';
import { loadConfig } from '../src/platform/config.js';
import { Container } from '../src/platform/container.js';
import { NotFoundError } from '../src/platform/errors.js';
import { BlastService } from '../src/modules/blast/service.js';
import type { BlastPull, BlastRepository, PriorPrRow } from '../src/modules/blast/repository.js';
import type { BlastResult, IndexState, RepoIntel } from '../src/modules/repo-intel/types.js';

const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

class FakeBlastRepo implements BlastRepository {
  constructor(
    private pull: BlastPull | undefined,
    private files: string[],
    private priorPrs: PriorPrRow[] = [],
  ) {}
  async getPull(_workspaceId: string, prId: string) {
    return this.pull?.id === prId ? this.pull : undefined;
  }
  async getPrFiles() {
    return this.files;
  }
  async getPriorPrsForFiles() {
    return this.priorPrs;
  }
}

function fakeIndexState(overrides: Partial<IndexState> = {}): IndexState {
  return {
    repoId: 'repo-1',
    status: 'full',
    filesIndexed: 10,
    filesSkipped: 0,
    durationMs: 100,
    lastIndexedSha: 'sha1',
    indexerVersion: 2,
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildContainer(opts: { blast: BlastResult; indexState: IndexState }): Container {
  const fakeRepoIntel: Partial<RepoIntel> = {
    getBlastRadius: async () => opts.blast,
    getIndexState: async () => opts.indexState,
  };
  return new Container(config, {} as Db, { repoIntel: fakeRepoIntel as RepoIntel });
}

describe('BlastService', () => {
  it('throws NotFoundError when the PR is missing or belongs to another workspace', async () => {
    const container = buildContainer({
      blast: { changedSymbols: [], callers: [], impactedEndpoints: [] },
      indexState: fakeIndexState(),
    });
    const service = new BlastService(new FakeBlastRepo(undefined, []), container);
    await expect(service.getBlastRadius('ws', 'missing')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('returns status: degraded (never a confident empty 200) when pr_files is empty', async () => {
    const container = buildContainer({
      blast: { changedSymbols: [], callers: [], impactedEndpoints: [] },
      indexState: fakeIndexState(),
    });
    const service = new BlastService(
      new FakeBlastRepo({ id: 'pr-1', repoId: 'repo-1' }, []),
      container,
    );
    const result = await service.getBlastRadius('ws', 'pr-1');

    expect(result.status).toBe('degraded');
    expect(result.changed_symbols).toEqual([]);
    expect(result.downstream).toEqual([]);
    expect(result.reason).toBeTruthy();
    // No file paths to overlap on this path — an empty list is honest, not a
    // silent failure (WI5).
    expect(result.prior_prs).toEqual([]);
    expect(() => BlastRadiusResponse.parse(result)).not.toThrow();
  });

  it('happy path: full index → status full, downstream grouped by symbol, composed summary', async () => {
    const blast: BlastResult = {
      changedSymbols: [{ file: 'src/a.ts', name: 'doThing', kind: 'function' }],
      callers: [
        { file: 'src/caller.ts', symbol: 'handler', viaSymbol: 'doThing', line: 12, rank: 5 },
      ],
      impactedEndpoints: ['GET /things'],
      factsByFile: { 'src/caller.ts': { endpoints: ['GET /things'], crons: [] } },
      degraded: false,
    };
    const container = buildContainer({ blast, indexState: fakeIndexState({ status: 'full' }) });
    const service = new BlastService(
      new FakeBlastRepo({ id: 'pr-1', repoId: 'repo-1' }, ['src/a.ts']),
      container,
    );
    const result = await service.getBlastRadius('ws', 'pr-1');

    expect(result.status).toBe('full');
    expect(result.reason).toBeNull();
    expect(result.changed_symbols).toEqual([{ name: 'doThing', file: 'src/a.ts', kind: 'function' }]);
    expect(result.downstream).toHaveLength(1);
    expect(result.downstream[0]).toMatchObject({
      symbol: 'doThing',
      callers: [{ name: 'handler', file: 'src/caller.ts', line: 12 }],
      endpoints_affected: ['GET /things'],
      crons_affected: [],
    });
    expect(result.summary).toContain('1 changed symbol');
    expect(() => BlastRadiusResponse.parse(result)).not.toThrow();
  });

  it('partial index → status: partial with a non-empty, specific reason', async () => {
    const blast: BlastResult = {
      changedSymbols: [{ file: 'src/a.ts', name: 'doThing', kind: 'function' }],
      callers: [],
      impactedEndpoints: [],
      factsByFile: {},
      degraded: false,
    };
    const container = buildContainer({
      blast,
      indexState: fakeIndexState({ status: 'partial', filesIndexed: 1842, filesSkipped: 768 }),
    });
    const service = new BlastService(
      new FakeBlastRepo({ id: 'pr-1', repoId: 'repo-1' }, ['src/a.ts']),
      container,
    );
    const result = await service.getBlastRadius('ws', 'pr-1');

    expect(result.status).toBe('partial');
    expect(result.reason).toBeTruthy();
    expect(result.reason).toContain('1842');
    expect(() => BlastRadiusResponse.parse(result)).not.toThrow();
  });

  it('prior_prs: two overlapping PRs surface in number-descending order with the right overlapping_files (WI5)', async () => {
    const blast: BlastResult = {
      changedSymbols: [{ file: 'src/a.ts', name: 'doThing', kind: 'function' }],
      callers: [],
      impactedEndpoints: [],
      factsByFile: {},
      degraded: false,
    };
    const container = buildContainer({ blast, indexState: fakeIndexState({ status: 'full' }) });
    // The fake repository stands in for the Drizzle query, which is what
    // actually does the `desc(number)` ordering (WI3) — given here already
    // in that order so this test verifies the service passes it through
    // unchanged rather than re-sorting or dropping fields.
    const priorPrs: PriorPrRow[] = [
      { id: 'pr-3', number: 80, title: 'Add rate limiting', author: 'bob', overlappingFiles: 3 },
      { id: 'pr-2', number: 50, title: 'Refactor billing', author: 'alice', overlappingFiles: 1 },
    ];
    const service = new BlastService(
      new FakeBlastRepo({ id: 'pr-1', repoId: 'repo-1' }, ['src/a.ts'], priorPrs),
      container,
    );
    const result = await service.getBlastRadius('ws', 'pr-1');

    expect(result.prior_prs).toEqual([
      { id: 'pr-3', number: 80, title: 'Add rate limiting', author: 'bob', overlapping_files: 3 },
      { id: 'pr-2', number: 50, title: 'Refactor billing', author: 'alice', overlapping_files: 1 },
    ]);
    expect(() => BlastRadiusResponse.parse(result)).not.toThrow();
  });
});
