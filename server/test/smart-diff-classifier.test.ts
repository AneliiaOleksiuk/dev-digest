/**
 * Smart Diff path classifier + grouping helpers (deterministic, no LLM).
 */
import { describe, it, expect } from 'vitest';
import { SmartDiffResponse } from '@devdigest/shared';
import {
  buildSplitSuggestion,
  classifyPath,
  findingLinesFor,
  groupFiles,
} from '../src/modules/smart-diff/helpers.js';
import { SPLIT_SUGGESTION_MAX_LINES } from '../src/modules/smart-diff/constants.js';

describe('classifyPath', () => {
  it('classifies lockfiles and package.json as boilerplate', () => {
    expect(classifyPath('package-lock.json')).toBe('boilerplate');
    expect(classifyPath('pnpm-lock.yaml')).toBe('boilerplate');
    expect(classifyPath('package.json')).toBe('boilerplate');
  });

  it('classifies tests as boilerplate', () => {
    expect(classifyPath('src/middleware/ratelimit.test.ts')).toBe('boilerplate');
    expect(classifyPath('test/ratelimit.test.ts')).toBe('boilerplate');
    expect(classifyPath('__tests__/foo.spec.ts')).toBe('boilerplate');
  });

  it('classifies generated / dist paths as boilerplate', () => {
    expect(classifyPath('dist/bundle.js')).toBe('boilerplate');
    expect(classifyPath('src/__snapshots__/x.snap')).toBe('boilerplate');
    expect(classifyPath('foo.generated.ts')).toBe('boilerplate');
  });

  it('classifies bootstrap / config as wiring (index.ts deliberate)', () => {
    expect(classifyPath('src/api/public/index.ts')).toBe('wiring');
    expect(classifyPath('src/server.ts')).toBe('wiring');
    expect(classifyPath('src/config.ts')).toBe('wiring');
    expect(classifyPath('vite.config.ts')).toBe('wiring');
    expect(classifyPath('.github/workflows/ci.yml')).toBe('wiring');
    expect(classifyPath('README.md')).toBe('wiring');
  });

  it('defaults unmatched source to core', () => {
    expect(classifyPath('src/middleware/ratelimit.ts')).toBe('core');
    expect(classifyPath('src/api/public/webhooks.ts')).toBe('core');
  });
});

describe('findingLinesFor', () => {
  it('dedups, sorts, clamps, and caps — pins to start_line (trigger)', () => {
    const lines = findingLinesFor(
      [
        { file: 'a.ts', start_line: 28, end_line: 52 },
        { file: 'a.ts', start_line: 28, end_line: 52 },
        { file: 'a.ts', start_line: 0, end_line: 1 },
        { file: 'b.ts', start_line: 1, end_line: 1 },
      ],
      'a.ts',
    );
    expect(lines).toEqual([1, 28]);
  });
});

describe('groupFiles + buildSplitSuggestion', () => {
  const files = [
    { path: 'src/middleware/ratelimit.ts', additions: 84, deletions: 8 },
    { path: 'src/server.ts', additions: 5, deletions: 1 },
    { path: 'package-lock.json', additions: 400, deletions: 10 },
  ];

  it('orders groups core → wiring → boilerplate and omits empty roles', () => {
    const groups = groupFiles(files, []);
    expect(groups.map((g) => g.role)).toEqual(['core', 'wiring', 'boilerplate']);
    expect(groups[0]!.files[0]!.path).toBe('src/middleware/ratelimit.ts');
    expect(groups[0]!.files[0]!.pseudocode_summary).toBeNull();
  });

  it('sorts files within a group by size desc then path', () => {
    const groups = groupFiles(
      [
        { path: 'src/b.ts', additions: 10, deletions: 0 },
        { path: 'src/a.ts', additions: 10, deletions: 0 },
        { path: 'src/c.ts', additions: 50, deletions: 0 },
      ],
      [],
    );
    expect(groups[0]!.files.map((f) => f.path)).toEqual(['src/c.ts', 'src/a.ts', 'src/b.ts']);
  });

  it('sets too_big above the threshold and proposes splits when ≥2 groups', () => {
    const groups = groupFiles(files, []);
    const total = files.reduce((n, f) => n + f.additions + f.deletions, 0);
    expect(total).toBeGreaterThan(SPLIT_SUGGESTION_MAX_LINES);
    const split = buildSplitSuggestion(groups, total);
    expect(split.too_big).toBe(true);
    expect(split.proposed_splits.map((p) => p.name)).toEqual(['core', 'wiring', 'boilerplate']);
  });

  it('leaves proposed_splits empty when not too_big or only one group', () => {
    const small = groupFiles([{ path: 'src/a.ts', additions: 1, deletions: 0 }], []);
    expect(buildSplitSuggestion(small, 1).proposed_splits).toEqual([]);
    expect(buildSplitSuggestion(small, 1).too_big).toBe(false);

    const oneRole = groupFiles(
      [
        { path: 'src/a.ts', additions: 300, deletions: 200 },
        { path: 'src/b.ts', additions: 50, deletions: 0 },
      ],
      [],
    );
    expect(oneRole).toHaveLength(1);
    const split = buildSplitSuggestion(oneRole, 550);
    expect(split.too_big).toBe(true);
    expect(split.proposed_splits).toEqual([]);
  });

  it('round-trips through SmartDiffResponse', () => {
    const groups = groupFiles(files, [
      { file: 'src/middleware/ratelimit.ts', start_line: 28 },
    ]);
    const total = files.reduce((n, f) => n + f.additions + f.deletions, 0);
    const parsed = SmartDiffResponse.parse({
      groups,
      split_suggestion: buildSplitSuggestion(groups, total),
    });
    expect(parsed.groups[0]!.files[0]!.finding_lines).toEqual([28]);
  });
});
