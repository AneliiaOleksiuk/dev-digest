import { describe, it, expect } from 'vitest';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';
import { MAX_CALLERS_PER_SYMBOL } from '../src/modules/repo-intel/constants.js';
import type { RepoBasics, ResolvedCallerRow } from '../src/modules/repo-intel/repository.js';
import type { CodeSymbol, CodeReference } from '@devdigest/shared';

/**
 * WI1 — per-changed-symbol caller cap + rank sort.
 *
 * `tryPersistentBlast` used to sort+slice `callers` GLOBALLY (a fan-out
 * symbol could starve every other changed symbol's callers), and the
 * ripgrep/degraded fallback in `getBlastRadius` applied no cap and no sort
 * at all. Both paths now share `capCallersPerSymbol` (service.ts, module
 * scope): group by `viaSymbol`, sort each group by `rank` desc with a
 * `file` asc / `line` asc tiebreak, take the top `MAX_CALLERS_PER_SYMBOL`
 * per group, concatenate groups in `changedSymbols` order.
 */

function zeroPad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

describe('RepoIntel — per-symbol caller cap (persistent path)', () => {
  it('caps a >20-caller symbol at MAX_CALLERS_PER_SYMBOL without starving a second symbol', async () => {
    const changedFile = 'src/a.ts';

    const symACallerCount = 25; // deliberately over the cap
    const symACallers: ResolvedCallerRow[] = Array.from({ length: symACallerCount }, (_, i) => ({
      fromPath: `rg/a-${zeroPad(i)}.ts`,
      toSymbol: 'symA',
      line: 1,
      rank: i + 1, // unique ranks 1..25, so "top 20" is unambiguous
    }));
    // Shuffle so the fix can't accidentally rely on input already being sorted.
    const shuffledSymACallers = [...symACallers].reverse();

    const symBCallers: ResolvedCallerRow[] = [
      { fromPath: 'rg/b-2.ts', toSymbol: 'symB', line: 1, rank: 202 },
      { fromPath: 'rg/b-1.ts', toSymbol: 'symB', line: 9, rank: 200 }, // tie on rank...
      { fromPath: 'rg/b-3.ts', toSymbol: 'symB', line: 2, rank: 200 }, // ...with this one
      { fromPath: 'rg/b-0.ts', toSymbol: 'symB', line: 1, rank: 204 },
      { fromPath: 'rg/b-4.ts', toSymbol: 'symB', line: 1, rank: 201 },
    ];

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
            { path: changedFile, name: 'symA', kind: 'function', line: 1, endLine: 5, exported: true, signature: null },
            { path: changedFile, name: 'symB', kind: 'function', line: 10, endLine: 15, exported: true, signature: null },
          ];
        }
        return []; // caller-file symbol rows — unused here, enclosing falls back to filename
      },
      getResolvedCallers: async () => [...shuffledSymACallers, ...symBCallers],
      getEdges: async () => [],
      getFileFacts: async () => [],
    };

    const result = await service.getBlastRadius('r1', [changedFile]);
    expect(result.degraded).toBe(false);

    const symACallersOut = result.callers.filter((c) => c.viaSymbol === 'symA');
    const symBCallersOut = result.callers.filter((c) => c.viaSymbol === 'symB');

    // (a) exactly MAX_CALLERS_PER_SYMBOL rows survive for the fan-out symbol.
    expect(symACallersOut).toHaveLength(MAX_CALLERS_PER_SYMBOL);
    // (b) the second symbol's callers all survive — the fan-out no longer starves it.
    expect(symBCallersOut).toHaveLength(symBCallers.length);

    // (c) each group is ordered by rank desc — symA's survivors are its 20 highest ranks.
    expect(symACallersOut.map((c) => c.rank)).toEqual(
      Array.from({ length: MAX_CALLERS_PER_SYMBOL }, (_, i) => symACallerCount - i),
    );
    // symB: rank desc, tie (200/200) broken by file asc ('rg/b-1.ts' < 'rg/b-3.ts').
    expect(symBCallersOut.map((c) => ({ file: c.file, rank: c.rank }))).toEqual([
      { file: 'rg/b-0.ts', rank: 204 },
      { file: 'rg/b-2.ts', rank: 202 },
      { file: 'rg/b-4.ts', rank: 201 },
      { file: 'rg/b-1.ts', rank: 200 },
      { file: 'rg/b-3.ts', rank: 200 },
    ]);

    // Groups concatenate in changedSymbols order (symA declared before symB).
    const firstSymBIndex = result.callers.findIndex((c) => c.viaSymbol === 'symB');
    const lastSymAIndex = result.callers.map((c) => c.viaSymbol).lastIndexOf('symA');
    expect(lastSymAIndex).toBeLessThan(firstSymBIndex);
  });
});

describe('RepoIntel — per-symbol caller cap (ripgrep/degraded path)', () => {
  it('caps and sorts identically when serving from the flag-off ripgrep fallback', async () => {
    const changedFile = 'src/a.ts';

    const allSymbols: CodeSymbol[] = [
      { path: changedFile, name: 'symA', kind: 'function', line: 1 },
      { path: changedFile, name: 'symB', kind: 'function', line: 20 },
    ];

    const symACallerCount = 25;
    const referencesBySymbol: Record<string, CodeReference[]> = {
      symA: Array.from({ length: symACallerCount }, (_, i) => ({
        fromPath: `rg/a-${zeroPad(i)}.ts`,
        toSymbol: 'symA',
        line: 1,
      })),
      symB: Array.from({ length: 4 }, (_, i) => ({
        fromPath: `rg/b-${i}.ts`,
        toSymbol: 'symB',
        line: 1,
      })),
    };

    const repoBasics: RepoBasics = {
      id: 'r1',
      owner: 'acme',
      name: 'widgets',
      defaultBranch: 'main',
      clonePath: 'C:/nonexistent-clone-path-for-test',
    };

    const container = {
      config: { repoIntelEnabled: false }, // forces the ripgrep fallback, skipping tryPersistentBlast
      db: {} as never,
      codeIndex: {
        symbols: async () => allSymbols,
        references: async (_ref: unknown, name: string) => referencesBySymbol[name] ?? [],
      },
    } as never;
    const service = new RepoIntelService(container);
    (service as unknown as { repo: Record<string, unknown> }).repo = {
      getRepoBasics: async () => repoBasics,
    };

    const result = await service.getBlastRadius('r1', [changedFile]);
    expect(result.degraded).toBe(true);

    const symACallersOut = result.callers.filter((c) => c.viaSymbol === 'symA');
    const symBCallersOut = result.callers.filter((c) => c.viaSymbol === 'symB');

    // Every row has rank 0 on this path — the cap+sort must fall back entirely
    // to the file-asc tiebreak to stay deterministic.
    expect(symACallersOut).toHaveLength(MAX_CALLERS_PER_SYMBOL);
    expect(symBCallersOut).toHaveLength(4);
    expect(symACallersOut.every((c) => c.rank === 0)).toBe(true);
    // Zero-padded filenames sort the same lexicographically and numerically —
    // the survivors are the 20 alphabetically-first caller files.
    expect(symACallersOut.map((c) => c.file)).toEqual(
      Array.from({ length: MAX_CALLERS_PER_SYMBOL }, (_, i) => `rg/a-${zeroPad(i)}.ts`),
    );
    expect(symBCallersOut.map((c) => c.file)).toEqual(['rg/b-0.ts', 'rg/b-1.ts', 'rg/b-2.ts', 'rg/b-3.ts']);
  });
});
