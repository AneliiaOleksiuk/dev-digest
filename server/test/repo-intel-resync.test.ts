/**
 * Manual resync — `RepoIntelService.resyncRepo`.
 *
 * Resync = fetch latest from origin (advance the clone), THEN delegate to the
 * incremental indexer. These tests assert the WIRING:
 *   - git.sync is called with the repo's `default_branch` before indexing
 *     (a resync, never a re-clone),
 *   - it degrades (never throws) when there's no clone or the fetch fails.
 *
 * The incremental slice itself is covered by indexer-pipeline.test.ts, so the
 * happy path here takes the cheap `sha_unchanged` branch — it exercises the
 * sync→delegate handoff without re-running the parse.
 */
import { describe, it, expect } from 'vitest';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';
import { MockGitClient } from '../src/adapters/mocks.js';
import { INDEXER_VERSION } from '../src/modules/repo-intel/constants.js';
import type { RepoIntelRepository } from '../src/modules/repo-intel/repository.js';
import type { IndexState } from '../src/modules/repo-intel/types.js';
import type { Container } from '../src/platform/container.js';

interface Basics {
  id: string;
  owner: string;
  name: string;
  defaultBranch: string;
  clonePath: string | null;
}

/** Build a service with a stubbed repository (no DB) + a MockGitClient. */
function makeService(opts: { basics: Basics | null; state?: IndexState | null; git: MockGitClient }) {
  let state = opts.state ?? null;
  const touched = { n: 0 };
  const repo = {
    getRepoBasics: async () => opts.basics,
    tryGetIndexState: async () => state,
    touchIndexState: async () => {
      touched.n += 1;
      if (state) state = { ...state, updatedAt: new Date() };
    },
  } as unknown as RepoIntelRepository;

  const container = {
    git: opts.git,
    db: {}, // never queried — service.repo is overridden below
    depgraph: { buildEdges: async () => [] },
    tokenizer: { count: (text: string) => Math.ceil(text.length / 4) },
  } as unknown as Container;

  const service = new RepoIntelService(container);
  (service as unknown as { repo: RepoIntelRepository }).repo = repo;
  return { service, touched };
}

function stateAt(sha: string): IndexState {
  return {
    repoId: 'r1',
    status: 'full',
    filesIndexed: 3,
    filesSkipped: 0,
    durationMs: 1,
    lastIndexedSha: sha,
    indexerVersion: INDEXER_VERSION,
    updatedAt: new Date(),
  };
}

describe('RepoIntelService.resyncRepo', () => {
  it('fetches the default branch, then delegates to the incremental indexer', async () => {
    const git = new MockGitClient({ head: 'sha-1', syncedHead: 'sha-1' });
    const { service, touched } = makeService({
      basics: { id: 'r1', owner: 'acme', name: 'app', defaultBranch: 'develop', clonePath: '/mock/clone' },
      state: stateAt('sha-1'),
      git,
    });

    const result = await service.resyncRepo('r1');

    // Resync advanced the clone against the repo's own default branch…
    expect(git.syncs).toHaveLength(1);
    expect(git.syncs[0]!.branch).toBe('develop');
    // …and the incremental pass ran (sha unchanged → touched, no error).
    expect(result.reason).toBe('sha_unchanged');
    expect(touched.n).toBe(1);
  });

  it('degrades to no_clone WITHOUT fetching when the repo is not cloned', async () => {
    const git = new MockGitClient({});
    const { service } = makeService({
      basics: { id: 'r1', owner: 'acme', name: 'app', defaultBranch: 'main', clonePath: null },
      git,
    });

    const result = await service.resyncRepo('r1');

    expect(result.status).toBe('degraded');
    expect(result.reason).toBe('no_clone');
    expect(git.syncs).toHaveLength(0);
  });

  it('degrades to sync_failed (never throws) when the fetch errors', async () => {
    const git = new MockGitClient({});
    git.sync = async () => {
      throw new Error('network down');
    };
    const { service } = makeService({
      basics: { id: 'r1', owner: 'acme', name: 'app', defaultBranch: 'main', clonePath: '/mock/clone' },
      git,
    });

    const result = await service.resyncRepo('r1');

    expect(result.status).toBe('degraded');
    expect(result.reason).toMatch(/^sync_failed:/);
  });

  // test-writer addition — AC-51/AC-52/Rec-5 (SPEC-01 amendment, WI5):
  // a dirty clone is a DISTINCT degraded reason from `sync_failed:` (never
  // folded into the network/fetch-failure bucket), and the reason is
  // persisted through `touchIndexState` so it becomes observable at
  // `GET /repos/:id/index-state` outside the job-swallowed RESYNC handler.
  // `MockGitClient`'s `dirtyPaths` option (WI5) is exactly what makes this
  // testable without a real git fixture — the real-git regression for
  // AC-38/AC-53 lives in `test/project-context-git-integrity.test.ts` (R-7).
  describe('AC-51/AC-52 — dirty-clone refusal (MockGitClient.dirtyPaths)', () => {
    it('degrades with a "dirty_clone:" reason — NEVER "sync_failed:" — when the clone has uncommitted changes', async () => {
      const git = new MockGitClient({ dirtyPaths: ['docs/edited.md', 'docs/created.md'] });
      const { service } = makeService({
        basics: { id: 'r1', owner: 'acme', name: 'app', defaultBranch: 'main', clonePath: '/mock/clone' },
        state: stateAt('sha-1'),
        git,
      });

      const result = await service.resyncRepo('r1');

      expect(result.status).toBe('degraded');
      expect(result.reason).toMatch(/^dirty_clone:/);
      expect(result.reason).not.toMatch(/^sync_failed:/);
      // The refusal happened BEFORE any fetch/reset — no sync recorded.
      expect(git.syncs).toHaveLength(0);
    });

    it('names the affected paths in the reason, bounded to MAX_DIRTY_PATHS_SHOWN (AC-52)', async () => {
      const manyPaths = Array.from({ length: 15 }, (_, i) => `docs/f${i}.md`);
      const git = new MockGitClient({ dirtyPaths: manyPaths });
      const { service } = makeService({
        basics: { id: 'r1', owner: 'acme', name: 'app', defaultBranch: 'main', clonePath: '/mock/clone' },
        state: stateAt('sha-1'),
        git,
      });

      const result = await service.resyncRepo('r1');

      expect(result.reason).toContain('docs/f0.md');
      expect(result.reason).not.toContain('docs/f10.md'); // 11th path — past the bound
      const shown = result.reason!.slice('dirty_clone:'.length).split(', ');
      expect(shown.length).toBeLessThanOrEqual(10);
    });

    it('persists the dirty reason through touchIndexState so a job-swallowed refusal is still observable (Rec-5)', async () => {
      const git = new MockGitClient({ dirtyPaths: ['docs/edited.md'] });
      let persisted: Record<string, unknown> | undefined;
      const repo = {
        getRepoBasics: async () => ({
          id: 'r1',
          owner: 'acme',
          name: 'app',
          defaultBranch: 'main',
          clonePath: '/mock/clone',
        }),
        tryGetIndexState: async () => stateAt('sha-1'),
        touchIndexState: async (_repoId: string, stats?: Record<string, unknown>) => {
          persisted = stats;
        },
      } as unknown as RepoIntelRepository;
      const container = {
        git,
        db: {},
        depgraph: { buildEdges: async () => [] },
        tokenizer: { count: (text: string) => Math.ceil(text.length / 4) },
      } as unknown as Container;
      const service = new RepoIntelService(container);
      (service as unknown as { repo: RepoIntelRepository }).repo = repo;

      await service.resyncRepo('r1');

      expect(persisted?.reason).toMatch(/^dirty_clone:docs\/edited\.md$/);
    });
  });
});
