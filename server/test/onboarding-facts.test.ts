/**
 * Onboarding WI4 — `collectFacts` fact-collection unit tests (no DB, no
 * Docker). `Container` built with a fake `RepoIntel` injected via
 * `ContainerOverrides.repoIntel` — same pattern as `test/blast-service.test.ts`
 * — plus a real temp clone directory on disk for the bounded file reads.
 *
 * Oracle: Development Plan WI4's Definition of done (an oversized fixture
 * asserting the dropped set and retained ascending-rank order (AC-13);
 * reading-path order equalling the facade's returned order (AC-9); a flat-
 * percentile fixture producing the flat-rank marker (E-4); a monorepo fixture
 * with three `package.json` files producing a deterministic, attributed
 * source set (E-7); no index/refresh/resync job enqueued during collection
 * (AC-3); AC-18/E-1's no-clone short-circuit).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Db } from '../src/db/client.js';
import { loadConfig } from '../src/platform/config.js';
import { Container } from '../src/platform/container.js';
import type { FileRankRow, IndexState, RepoIntel } from '../src/modules/repo-intel/types.js';
import { collectFacts } from '../src/modules/onboarding/facts.js';
import { MAX_RUN_LOCALLY_SOURCES } from '../src/modules/onboarding/constants.js';

const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** Char-count tokenizer — makes `FACTS_TOKEN_BUDGET` cutoffs exact and
 *  readable in test fixtures instead of depending on tiktoken's BPE. */
const charTokenizer = { count: (text: string) => text.length };

function fakeIndexState(overrides: Partial<IndexState> = {}): IndexState {
  return {
    repoId: 'repo-1',
    status: 'full',
    filesIndexed: 42,
    filesSkipped: 0,
    durationMs: 10,
    lastIndexedSha: 'sha-1',
    indexerVersion: 2,
    updatedAt: new Date(),
    ...overrides,
  };
}

interface FakeRepoIntelOpts {
  indexState?: IndexState;
  repoMap?: { text: string; tokens: number; cached: boolean; degraded?: boolean };
  rankedFiles?: string[];
  criticalPathChains?: string[][];
  fileRankRows?: FileRankRow[];
}

function buildContainer(opts: FakeRepoIntelOpts = {}) {
  const calls = { getRepoMap: 0, getTopFilesByRank: 0, getCriticalPaths: 0, getFileRank: 0, indexRepo: 0, refreshIndex: 0 };
  const fakeRepoIntel: Partial<RepoIntel> = {
    getIndexState: async () => opts.indexState ?? fakeIndexState(),
    getRepoMap: async () => {
      calls.getRepoMap++;
      return opts.repoMap ?? { text: '', tokens: 0, cached: false };
    },
    getTopFilesByRank: async () => {
      calls.getTopFilesByRank++;
      return opts.rankedFiles ?? [];
    },
    getCriticalPaths: async () => {
      calls.getCriticalPaths++;
      return opts.criticalPathChains ?? [];
    },
    getFileRank: async () => {
      calls.getFileRank++;
      return opts.fileRankRows ?? [];
    },
    indexRepo: async () => {
      calls.indexRepo++;
      return { status: 'full', filesIndexed: 0, filesSkipped: 0, durationMs: 0 };
    },
    refreshIndex: async () => {
      calls.refreshIndex++;
      return { status: 'full', filesIndexed: 0, filesSkipped: 0, durationMs: 0 };
    },
  };
  const container = new Container(config, {} as Db, {
    repoIntel: fakeRepoIntel as RepoIntel,
    tokenizer: charTokenizer,
  });
  return { container, calls };
}

describe('collectFacts', () => {
  let clonePath: string;

  beforeAll(async () => {
    clonePath = await mkdtemp(join(tmpdir(), 'onboarding-facts-'));
  });
  afterAll(async () => {
    await rm(clonePath, { recursive: true, force: true });
  });

  // -------------------------------------------------------------- AC-18/E-1
  it('AC-18/E-1: clonePath null short-circuits to the no-clone marker — no facade rank/map/critical-path calls', async () => {
    const { container, calls } = buildContainer({ rankedFiles: ['src/a.ts'] });
    const facts = await collectFacts(container, 'repo-1', null);

    expect(facts.noClone).toBe(true);
    expect(facts.rankedFiles).toEqual([]);
    expect(facts.rankedExcerpts).toEqual([]);
    expect(facts.runLocallySources).toEqual([]);
    // Only getIndexState is ever called on the no-clone path.
    expect(calls.getRepoMap).toBe(0);
    expect(calls.getTopFilesByRank).toBe(0);
    expect(calls.getCriticalPaths).toBe(0);
    expect(calls.getFileRank).toBe(0);
  });

  // ------------------------------------------------------------------ AC-3
  it('AC-3: never runs or enqueues an index/refresh job during collection, even with a real clone', async () => {
    const { container, calls } = buildContainer({ rankedFiles: [] });
    await collectFacts(container, 'repo-1', clonePath);
    expect(calls.indexRepo).toBe(0);
    expect(calls.refreshIndex).toBe(0);
  });

  // ------------------------------------------------------------------ AC-9
  it("AC-9: rankedFiles is exactly the facade's own order — never re-ranked here", async () => {
    const dir = await mkdtemp(join(tmpdir(), 'onboarding-facts-ac9-'));
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src', 'z.ts'), 'export const z = 1;');
    await writeFile(join(dir, 'src', 'a.ts'), 'export const a = 1;');
    // Facade order is deliberately NOT alphabetical — z before a.
    const { container } = buildContainer({ rankedFiles: ['src/z.ts', 'src/a.ts'] });

    const facts = await collectFacts(container, 'repo-1', dir);
    expect(facts.rankedFiles).toEqual(['src/z.ts', 'src/a.ts']);
    expect(facts.rankedExcerpts.map((e) => e.path)).toEqual(['src/z.ts', 'src/a.ts']);

    await rm(dir, { recursive: true, force: true });
  });

  // ----------------------------------------------------------------- AC-13
  it('AC-13: an oversized ranked-file set is cut at the token budget — dropped set is the ascending-rank (lowest-ranked) tail, kept set stays in order', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'onboarding-facts-ac13-'));
    await mkdir(join(dir, 'src'), { recursive: true });
    // Four files, 3000 chars each ⇒ 3000 "tokens" with the char tokenizer.
    // FACTS_TOKEN_BUDGET (8000): f1 (3000) + f2 (3000) = 6000 fits; f3 would
    // push to 9000 > 8000 ⇒ f3 and f4 (the lower-ranked tail) are dropped.
    const files = ['f1.ts', 'f2.ts', 'f3.ts', 'f4.ts'];
    for (const f of files) {
      await writeFile(join(dir, 'src', f), 'x'.repeat(3000));
    }
    const rankedFiles = files.map((f) => `src/${f}`);
    const { container } = buildContainer({ rankedFiles });

    const facts = await collectFacts(container, 'repo-1', dir);

    expect(facts.rankedExcerpts.map((e) => e.path)).toEqual(['src/f1.ts', 'src/f2.ts']);
    expect(facts.droppedForBudget).toEqual(['src/f3.ts', 'src/f4.ts']);
    // Never a mid-file truncation of a KEPT excerpt — each kept excerpt is
    // the full (capped-at-MAX_EXCERPT_CHARS, here under the cap) content.
    expect(facts.rankedExcerpts[0]!.content).toHaveLength(3000);

    await rm(dir, { recursive: true, force: true });
  });

  // ------------------------------------------------------------------- E-4
  it('E-4: ≤1 distinct file-rank percentile across the sampled files ⇒ flatRank (no import-graph signal)', async () => {
    const { container: flatContainer } = buildContainer({
      rankedFiles: ['a.ts', 'b.ts', 'c.ts'],
      fileRankRows: [
        { path: 'a.ts', percentile: 0.5 },
        { path: 'b.ts', percentile: 0.5 },
        { path: 'c.ts', percentile: 0.5 },
      ],
    });
    const flat = await collectFacts(flatContainer, 'repo-1', clonePath);
    expect(flat.flatRank).toBe(true);

    const { container: rankedContainer } = buildContainer({
      rankedFiles: ['a.ts', 'b.ts', 'c.ts'],
      fileRankRows: [
        { path: 'a.ts', percentile: 0.9 },
        { path: 'b.ts', percentile: 0.5 },
        { path: 'c.ts', percentile: 0.1 },
      ],
    });
    const ranked = await collectFacts(rankedContainer, 'repo-1', clonePath);
    expect(ranked.flatRank).toBe(false);
  });

  // ------------------------------------------------------------------- E-7
  it('E-7: a monorepo with several package.json files at depth ≤2 collects them all, sorted by path, attributed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'onboarding-facts-e7-'));
    await mkdir(join(dir, 'server'), { recursive: true });
    await mkdir(join(dir, 'client'), { recursive: true });
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'root', scripts: { dev: 'x' } }));
    await writeFile(join(dir, 'server', 'package.json'), JSON.stringify({ name: 'server' }));
    await writeFile(join(dir, 'client', 'package.json'), JSON.stringify({ name: 'client' }));
    const { container } = buildContainer({ rankedFiles: [] });

    const facts = await collectFacts(container, 'repo-1', dir);
    const paths = facts.runLocallySources.map((s) => s.path).sort();
    expect(paths).toEqual(['client/package.json', 'package.json', 'server/package.json']);

    await rm(dir, { recursive: true, force: true });
  });

  it('E-7/Recommendation-3: package.json discovery is capped at MAX_RUN_LOCALLY_SOURCES', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'onboarding-facts-e7-cap-'));
    for (let i = 0; i < MAX_RUN_LOCALLY_SOURCES + 3; i++) {
      const sub = join(dir, `pkg-${i}`);
      await mkdir(sub, { recursive: true });
      await writeFile(join(sub, 'package.json'), JSON.stringify({ name: `pkg-${i}` }));
    }
    const { container } = buildContainer({ rankedFiles: [] });

    const facts = await collectFacts(container, 'repo-1', dir);
    const packageJsonSources = facts.runLocallySources.filter((s) => s.path.endsWith('package.json'));
    expect(packageJsonSources.length).toBeLessThanOrEqual(MAX_RUN_LOCALLY_SOURCES);

    await rm(dir, { recursive: true, force: true });
  });
});
