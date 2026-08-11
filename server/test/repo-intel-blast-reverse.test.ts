import { describe, it, expect } from 'vitest';
import {
  RepoIntelService,
  reverseImportReach,
} from '../src/modules/repo-intel/service.js';
import { BFS_DEPTH } from '../src/modules/repo-intel/constants.js';
import { mapBlastResult } from '../src/modules/blast/helpers.js';
import type { BlastResult } from '../src/modules/repo-intel/types.js';

/**
 * L04 acceptance fix — reverse import-graph (imported → importers) capped
 * at BFS_DEPTH, plus blast mapper attribution of endpoints on dependents.
 */

describe('reverseImportReach', () => {
  it('walks imported→importers up to depth 2 and ignores forward imports + hop 3', () => {
    // Edges are stored importer → imported (fromFile imports toFile).
    const edges = [
      { fromFile: 'src/b.ts', toFile: 'src/a.ts' }, // B imports A
      { fromFile: 'src/routes.ts', toFile: 'src/b.ts' }, // routes imports B (hop 2 from A)
      { fromFile: 'src/too-far.ts', toFile: 'src/routes.ts' }, // hop 3 from A — excluded
      { fromFile: 'src/a.ts', toFile: 'src/lib.ts' }, // A's own dependency — NOT a dependent
    ];

    const reach = reverseImportReach(edges, ['src/a.ts'], BFS_DEPTH);
    const dependents = new Set(reach.get('src/a.ts') ?? []);

    expect(dependents.has('src/b.ts')).toBe(true);
    expect(dependents.has('src/routes.ts')).toBe(true);
    expect(dependents.has('src/too-far.ts')).toBe(false);
    expect(dependents.has('src/lib.ts')).toBe(false);
    expect(dependents.has('src/a.ts')).toBe(false);
  });
});

describe('RepoIntel — reverse import endpoints on persistent blast', () => {
  it('attributes endpoints from reverse-reach dependents to symbols in the declaring file', async () => {
    const changedFile = 'src/a.ts';
    const container = {
      config: { repoIntelEnabled: true },
      db: {} as never,
      codeIndex: { symbols: async () => [], references: async () => [] } as never,
    } as never;
    const service = new RepoIntelService(container);
    (service as unknown as { repo: Record<string, unknown> }).repo = {
      tryGetIndexState: async () => ({ status: 'full' }),
      getSymbolRows: async (_repoId: string, paths: string[]) => {
        if (paths.length === 1 && paths[0] === changedFile) {
          return [
            {
              path: changedFile,
              name: 'helper',
              kind: 'function',
              line: 1,
              endLine: 5,
              exported: true,
              signature: null,
            },
          ];
        }
        return [];
      },
      // No direct callers — endpoints must come from reverse-import reach alone.
      getResolvedCallers: async () => [],
      getNameMatchedCallers: async () => [],
      getEdges: async () => [
        { fromFile: 'src/b.ts', toFile: changedFile },
        { fromFile: 'src/routes.ts', toFile: 'src/b.ts' },
        { fromFile: 'src/too-far.ts', toFile: 'src/routes.ts' },
      ],
      getFileFacts: async (_repoId: string, files: string[]) => {
        const rows = [];
        if (files.includes('src/routes.ts')) {
          rows.push({
            filePath: 'src/routes.ts',
            endpoints: ['GET /api/items'],
            crons: ['reset-buckets (hourly)'],
          });
        }
        if (files.includes('src/too-far.ts')) {
          rows.push({
            filePath: 'src/too-far.ts',
            endpoints: ['GET /should-not-appear'],
            crons: [],
          });
        }
        return rows;
      },
    };

    const result = await service.getBlastRadius('r1', [changedFile]);
    expect(result.degraded).toBe(false);
    expect(result.dependentFilesByDeclFile?.[changedFile]?.sort()).toEqual(
      ['src/b.ts', 'src/routes.ts'].sort(),
    );
    expect(result.impactedEndpoints).toContain('GET /api/items');
    expect(result.impactedEndpoints).not.toContain('GET /should-not-appear');
    expect(result.factsByFile?.['src/routes.ts']?.endpoints).toEqual(['GET /api/items']);

    const mapped = mapBlastResult(result);
    expect(mapped.downstream[0]?.endpoints_affected).toContain('GET /api/items');
    expect(mapped.downstream[0]?.crons_affected).toContain('reset-buckets (hourly)');
    expect(mapped.downstream[0]?.endpoints_affected).not.toContain('GET /should-not-appear');
  });
});

describe('RepoIntel — name-matched callers when decl_file is unresolved', () => {
  it('surfaces cross-file name matches when getResolvedCallers returns empty', async () => {
    const changedFile = 'src/rateLimit.ts';
    const container = {
      config: { repoIntelEnabled: true },
      db: {} as never,
      codeIndex: { symbols: async () => [], references: async () => [] } as never,
    } as never;
    const service = new RepoIntelService(container);
    (service as unknown as { repo: Record<string, unknown> }).repo = {
      tryGetIndexState: async () => ({ status: 'full' }),
      getSymbolRows: async (_repoId: string, paths: string[]) => {
        if (paths.length === 1 && paths[0] === changedFile) {
          return [
            {
              path: changedFile,
              name: 'rateLimit',
              kind: 'function',
              line: 1,
              endLine: 10,
              exported: true,
              signature: null,
            },
          ];
        }
        if (paths.includes('src/routes.ts')) {
          return [
            {
              path: 'src/routes.ts',
              name: 'handler',
              kind: 'function',
              line: 1,
              endLine: 20,
              exported: true,
              signature: null,
            },
          ];
        }
        return [];
      },
      getResolvedCallers: async () => [],
      getNameMatchedCallers: async () => [
        {
          fromPath: 'src/routes.ts',
          toSymbol: 'rateLimit',
          line: 8,
          rank: 1,
        },
        // Same-file hit must be filtered out by tryPersistentBlast.
        {
          fromPath: changedFile,
          toSymbol: 'rateLimit',
          line: 3,
          rank: 0,
        },
      ],
      getEdges: async () => [],
      getFileFacts: async (_repoId: string, files: string[]) => {
        if (files.includes('src/routes.ts')) {
          return [
            {
              filePath: 'src/routes.ts',
              endpoints: ['GET /api/ping'],
              crons: [],
            },
          ];
        }
        return [];
      },
    };

    const result = await service.getBlastRadius('r1', [changedFile]);
    expect(result.degraded).toBe(false);
    expect(result.callers).toEqual([
      {
        file: 'src/routes.ts',
        symbol: 'handler',
        viaSymbol: 'rateLimit',
        line: 8,
        rank: 1,
      },
    ]);
    expect(result.impactedEndpoints).toContain('GET /api/ping');
  });
});

describe('mapBlastResult — reverse-reach attribution is per declaring file', () => {
  it('does not dump another file\'s reverse-reach endpoints onto a sibling symbol', () => {
    const blast: BlastResult = {
      changedSymbols: [
        { file: 'src/a.ts', name: 'aFn', kind: 'function' },
        { file: 'src/other.ts', name: 'otherFn', kind: 'function' },
      ],
      callers: [],
      impactedEndpoints: ['GET /from-a', 'GET /from-other'],
      factsByFile: {
        'src/dep-a.ts': { endpoints: ['GET /from-a'], crons: [] },
        'src/dep-other.ts': { endpoints: ['GET /from-other'], crons: [] },
      },
      dependentFilesByDeclFile: {
        'src/a.ts': ['src/dep-a.ts'],
        'src/other.ts': ['src/dep-other.ts'],
      },
      degraded: false,
    };

    const mapped = mapBlastResult(blast);
    const a = mapped.downstream.find((g) => g.symbol === 'aFn');
    const other = mapped.downstream.find((g) => g.symbol === 'otherFn');
    expect(a?.endpoints_affected).toEqual(['GET /from-a']);
    expect(other?.endpoints_affected).toEqual(['GET /from-other']);
  });
});
