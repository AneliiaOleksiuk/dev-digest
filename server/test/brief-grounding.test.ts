/**
 * Brief module — grounding.ts (WI6, SPEC-03). Pure unit tests, no DB/adapters.
 *
 * Oracle (derived from docs/plans/spec-03-pr-brief-and-why-timeline.md WI6
 * DoD + specs/SPEC-03-pr-brief-and-why-timeline.md AC-18/19/20/21/39, read
 * BEFORE opening grounding.ts):
 *   - AC-18: a `risks[].file_refs` path not in the changed-file set is
 *     dropped; the risk itself survives even with an emptied file_refs.
 *   - AC-19: a `review_focus[]` entry with an unknown path OR an in-range
 *     path but out-of-range line is dropped — one case each.
 *   - AC-20: offending items are DROPPED, never repaired/rewritten.
 *   - AC-21: a fully-ungrounded response still yields a persisted-shape
 *     brief with empty risks/review_focus, not a failure.
 *   - AC-39: a `../../etc/passwd`-shaped model path is dropped without any
 *     filesystem access — asserted structurally (grounding.ts never imports
 *     `node:fs`).
 */
import { describe, it, expect } from 'vitest';
import type { Risk, ReviewFocusItem, UnifiedDiff } from '@devdigest/shared';
import { groundBrief } from '../src/modules/brief/grounding.js';

function diff(overrides: Partial<UnifiedDiff> = {}): UnifiedDiff {
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
      {
        path: 'src/server.ts',
        additions: 1,
        deletions: 0,
        hunks: [
          { file: 'src/server.ts', oldStart: 5, oldLines: 0, newStart: 5, newLines: 1, newLineNumbers: [] },
        ],
      },
    ],
    ...overrides,
  };
}

function risk(overrides: Partial<Risk> = {}): Risk {
  return {
    kind: 'security',
    title: 'Hardcoded secret',
    explanation: 'A live key appears to be committed.',
    severity: 'high',
    file_refs: ['src/config.ts'],
    ...overrides,
  };
}

function focusItem(overrides: Partial<ReviewFocusItem> = {}): ReviewFocusItem {
  return { path: 'src/config.ts', line: 11, reason: 'Live key committed in plaintext', ...overrides };
}

describe('brief/grounding — groundBrief (WI6)', () => {
  it('AC-18: a file_refs path not in the changed-file set is dropped, but the risk itself survives (even emptied)', () => {
    const raw = {
      what: 'x',
      why: 'y',
      risk_level: 'high' as const,
      risks: [risk({ file_refs: ['src/does-not-exist.ts'] })],
      review_focus: [],
    };
    const result = groundBrief(raw, diff());
    expect(result.brief.risks).toHaveLength(1);
    expect(result.brief.risks[0]!.file_refs).toEqual([]);
    expect(result.brief.risks[0]!.title).toBe('Hardcoded secret'); // untouched, not repaired away
    expect(result.droppedRiskRefs).toBe(1);
  });

  it('AC-18: a mix of a real and a fake ref keeps only the real one', () => {
    const raw = {
      what: 'x',
      why: 'y',
      risk_level: 'medium' as const,
      risks: [risk({ file_refs: ['src/config.ts', 'src/ghost.ts'] })],
      review_focus: [],
    };
    const result = groundBrief(raw, diff());
    expect(result.brief.risks[0]!.file_refs).toEqual(['src/config.ts']);
    expect(result.droppedRiskRefs).toBe(1);
  });

  it('AC-19: a review_focus entry naming an unknown path is dropped', () => {
    const raw = {
      what: 'x',
      why: 'y',
      risk_level: 'low' as const,
      risks: [],
      review_focus: [focusItem({ path: 'src/does-not-exist.ts', line: 10 })],
    };
    const result = groundBrief(raw, diff());
    expect(result.brief.review_focus).toEqual([]);
    expect(result.droppedFocusItems).toBe(1);
  });

  it('AC-19/E-8: a review_focus entry with a REAL path but an out-of-range line is dropped (the sharper case)', () => {
    const raw = {
      what: 'x',
      why: 'y',
      risk_level: 'low' as const,
      risks: [],
      review_focus: [focusItem({ path: 'src/config.ts', line: 999 })],
    };
    const result = groundBrief(raw, diff());
    expect(result.brief.review_focus).toEqual([]);
    expect(result.droppedFocusItems).toBe(1);
  });

  it('AC-19: an in-range line on the real file is KEPT', () => {
    const raw = {
      what: 'x',
      why: 'y',
      risk_level: 'low' as const,
      risks: [],
      review_focus: [focusItem({ path: 'src/config.ts', line: 11 })],
    };
    const result = groundBrief(raw, diff());
    expect(result.brief.review_focus).toHaveLength(1);
    expect(result.droppedFocusItems).toBe(0);
  });

  it('AC-19: a hunk with no newLineNumbers falls back to [newStart, newStart+newLines) — line 5 admitted for src/server.ts', () => {
    const raw = {
      what: 'x',
      why: 'y',
      risk_level: 'low' as const,
      risks: [],
      review_focus: [focusItem({ path: 'src/server.ts', line: 5 })],
    };
    const result = groundBrief(raw, diff());
    expect(result.brief.review_focus).toHaveLength(1);
  });

  it('AC-20: grounding DROPS offending items, never repairs/rewrites them (no "closest match" substitution)', () => {
    const raw = {
      what: 'x',
      why: 'y',
      risk_level: 'low' as const,
      risks: [],
      review_focus: [focusItem({ path: 'src/config.ts', line: 10_000 })],
    };
    const result = groundBrief(raw, diff());
    // Dropped, not rewritten to the nearest real line.
    expect(result.brief.review_focus).toEqual([]);
    expect(result.brief.review_focus.some((f) => f.line !== 10_000)).toBe(false);
  });

  it('AC-21: a fully-ungrounded response persists as an honestly empty brief, not a failure', () => {
    const raw = {
      what: 'Adds a new endpoint',
      why: 'Needed for X',
      risk_level: 'medium' as const,
      risks: [risk({ file_refs: ['nonexistent.ts'] })],
      review_focus: [focusItem({ path: 'nonexistent.ts', line: 1 })],
    };
    const result = groundBrief(raw, diff());
    expect(result.brief.risks).toHaveLength(1); // risk survives, refs emptied
    expect(result.brief.risks[0]!.file_refs).toEqual([]);
    expect(result.brief.review_focus).toEqual([]);
    expect(result.brief.what).toBe('Adds a new endpoint'); // prose untouched
    expect(result.brief.why).toBe('Needed for X');
  });

  it('AC-39: a `../../etc/passwd`-shaped review_focus path is dropped (not in the changed-file set)', () => {
    const raw = {
      what: 'x',
      why: 'y',
      risk_level: 'low' as const,
      risks: [risk({ file_refs: ['../../etc/passwd'] })],
      review_focus: [focusItem({ path: '../../etc/passwd', line: 1 })],
    };
    const result = groundBrief(raw, diff());
    expect(result.brief.review_focus).toEqual([]);
    expect(result.brief.risks[0]!.file_refs).toEqual([]);
  });

  it('AC-39: grounding.ts never imports node:fs (structural — a model path can never reach the filesystem here)', async () => {
    const src = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../src/modules/brief/grounding.ts', import.meta.url), 'utf8'),
    );
    expect(src).not.toMatch(/from ['"]node:fs/);
    expect(src).not.toMatch(/readFile|writeFile|existsSync/);
  });
});
