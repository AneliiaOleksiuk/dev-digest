import { describe, it, expect } from 'vitest';
import { EvalCaseFromFindingInput } from '@devdigest/shared';
import {
  mapRowToRecord,
  assertDiffWithinCap,
  deriveMatchScope,
  deriveExpectationKind,
  buildExpectationEntry,
  buildDiffText,
} from '../src/modules/eval/helpers.js';
import { MAX_INPUT_DIFF_BYTES, FULL_FILE_KINDS } from '../src/modules/eval/constants.js';
import type { EvalCaseRow } from '../src/modules/eval/repository.js';

/**
 * WI4/WI5 pure helpers (`modules/eval/helpers.ts`) — no DB, no `Container`
 * (onion-architecture "no I/O in helpers" rule, which is also what makes
 * these unit-testable with plain objects). Oracle:
 * `docs/plans/eval-pipeline.md` WI4/WI5 + `specs/eval-pipeline.md` AC-3,
 * AC-9, AC-13/E-12, AC-46, Q-6, D-7.
 */

function row(overrides: Partial<EvalCaseRow> = {}): EvalCaseRow {
  return {
    id: 'case-1',
    workspaceId: 'ws-1',
    ownerKind: 'agent',
    ownerId: 'agent-1',
    name: 'A case',
    inputDiff: 'diff --git a/x b/x',
    inputFiles: null,
    inputMeta: null,
    expectedOutput: { version: 1, must_find: [], must_not_flag: [] },
    notes: null,
    ...overrides,
  };
}

describe('mapRowToRecord — AC-13, E-12 (read-side degradation)', () => {
  it('a valid expected_output round-trips with expectation_status: "ok"', () => {
    const rec = mapRowToRecord(row());
    expect(rec.expectation_status).toBe('ok');
    expect(rec.expected_output).toEqual({ version: 1, must_find: [], must_not_flag: [] });
  });

  it('a hand-corrupted expected_output degrades to expectation_status: "unusable" + expected_output: null, WITHOUT throwing', () => {
    const corrupted = row({ expectedOutput: { totally: 'not-an-expectation' } });
    expect(() => mapRowToRecord(corrupted)).not.toThrow();
    const rec = mapRowToRecord(corrupted);
    expect(rec.expectation_status).toBe('unusable');
    expect(rec.expected_output).toBeNull();
  });

  it('a legacy z.unknown()-era row (pre-AC-11 shape, e.g. a bare array) also degrades cleanly', () => {
    const legacy = row({ expectedOutput: ['must find something'] });
    const rec = mapRowToRecord(legacy);
    expect(rec.expectation_status).toBe('unusable');
    expect(rec.expected_output).toBeNull();
  });
});

describe('assertDiffWithinCap — AC-46', () => {
  it('accepts a diff at or under the cap', () => {
    expect(() => assertDiffWithinCap('a'.repeat(MAX_INPUT_DIFF_BYTES))).not.toThrow();
  });

  it('rejects an oversized diff with a NAMED error, not a silent truncation', () => {
    const oversized = 'a'.repeat(MAX_INPUT_DIFF_BYTES + 1);
    expect(() => assertDiffWithinCap(oversized)).toThrow();
    try {
      assertDiffWithinCap(oversized);
      expect.unreachable();
    } catch (err) {
      expect((err as { code?: string }).code).toBe('diff_too_large');
      expect((err as { statusCode?: number }).statusCode).toBe(422);
    }
  });
});

describe('deriveMatchScope — Q-6', () => {
  it.each([...FULL_FILE_KINDS])('%s → match_scope "file" (grounding full-file exemption)', (kind) => {
    expect(deriveMatchScope(kind)).toBe('file');
  });

  it('an ordinary "finding" kind → match_scope "range"', () => {
    expect(deriveMatchScope('finding')).toBe('range');
  });

  it('an unrecognized kind also defaults to "range" (only the four exempt kinds get "file")', () => {
    expect(deriveMatchScope('something_new')).toBe('range');
  });
});

describe('deriveExpectationKind — AC-3', () => {
  it('accepted (acceptedAt set) → "must_find"', () => {
    expect(deriveExpectationKind({ acceptedAt: new Date(), dismissedAt: null })).toBe('must_find');
  });

  it('dismissed (dismissedAt set) → "must_not_flag"', () => {
    expect(deriveExpectationKind({ acceptedAt: null, dismissedAt: new Date() })).toBe('must_not_flag');
  });

  it('pending (neither timestamp set) → null (refuse)', () => {
    expect(deriveExpectationKind({ acceptedAt: null, dismissedAt: null })).toBeNull();
  });
});

describe('buildExpectationEntry — AC-9', () => {
  it('carries source_finding_id as provenance, plus the derived match_scope', () => {
    const entry = buildExpectationEntry({
      id: 'finding-42',
      file: 'src/config.ts',
      startLine: 12,
      endLine: 12,
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      kind: 'secret_leak',
    });
    expect(entry.source_finding_id).toBe('finding-42');
    expect(entry.file).toBe('src/config.ts');
    expect(entry.start_line).toBe(12);
    expect(entry.end_line).toBe(12);
    expect(entry.match_scope).toBe('file'); // secret_leak is a FULL_FILE_KINDS member
  });
});

describe('buildDiffText — AC-7', () => {
  it('reassembles a unified diff in the diffFromPrFiles shape: diff --git / --- / +++ / patch, four lines per file', () => {
    const text = buildDiffText([{ path: 'src/a.ts', patch: '@@ -1,1 +1,1 @@\n-old\n+new' }]);
    const lines = text.split('\n');
    expect(lines[0]).toBe('diff --git a/src/a.ts b/src/a.ts');
    expect(lines[1]).toBe('--- a/src/a.ts');
    expect(lines[2]).toBe('+++ b/src/a.ts');
    expect(lines.slice(3).join('\n')).toBe('@@ -1,1 +1,1 @@\n-old\n+new');
  });

  it('skips a file with no patch rather than rendering an empty diff for it', () => {
    const text = buildDiffText([
      { path: 'src/a.ts', patch: null },
      { path: 'src/b.ts', patch: '@@ hunk @@' },
    ]);
    expect(text).not.toContain('src/a.ts');
    expect(text).toContain('src/b.ts');
  });
});

describe('D-7 — a body-supplied expectation "kind" is structurally impossible', () => {
  it('EvalCaseFromFindingInput has no field beyond an optional "name" — no "kind" property exists to override the server-derived value', () => {
    // Not just "ignored at runtime" — the schema itself has no slot for it,
    // so a client cannot even express the field, let alone have it win.
    const shape = EvalCaseFromFindingInput.shape;
    expect(Object.keys(shape)).toEqual(['name']);

    // A body that TRIES to smuggle a kind is parsed with that key silently
    // stripped (zod's default non-strict behaviour) — proving the extra key
    // has no effect on the parsed value the service ever sees.
    const parsed = EvalCaseFromFindingInput.parse({ name: 'x', kind: 'must_not_flag' });
    expect(parsed).toEqual({ name: 'x' });
    expect('kind' in parsed).toBe(false);
  });
});
