import { describe, it, expect } from 'vitest';
import {
  deriveFindingGroups,
  deriveConflicts,
  normalizeFilePath,
  type DerivableRun,
  type DerivableFinding,
} from '../src/modules/reviews/multi-agent-derive.js';

/**
 * L07 (SPEC-04) — pure unit tests for the grouping/conflict-derivation
 * function (WI6/WI2 in docs/plans/spec-04-multi-agent-review.md).
 *
 * Oracle derived from specs/SPEC-04-multi-agent-review.md AC-22..AC-25,
 * AC-29..AC-30, E-10, E-11, E-12, E-13 and D-14 BEFORE reading
 * `multi-agent-derive.ts` in depth. One exception, called out explicitly by
 * this fix-loop's own briefing: `deriveConflicts` no longer pre-filters to
 * "genuine" AC-30 conflicts — it emits every shared location, unfiltered —
 * so the AC-30/AC-31 tests below assert the CURRENT unfiltered-emission
 * contract, not the AC-30 filter itself (that filter is now a client-side
 * concern over this function's full output).
 */

let idSeq = 0;
function finding(overrides: Partial<DerivableFinding> = {}): DerivableFinding {
  idSeq += 1;
  return {
    id: `f-${idSeq}`,
    run_id: 'run-1',
    agent_id: 'agent-1',
    agent_name: 'Security Reviewer',
    file: 'src/config.ts',
    start_line: 10,
    end_line: 10,
    category: 'security',
    severity: 'WARNING',
    title: 'title',
    rationale: 'rationale',
    suggestion: null,
    confidence: 0.8,
    ...overrides,
  };
}

function run(overrides: Partial<DerivableRun> = {}): DerivableRun {
  return {
    run_id: 'run-1',
    agent_id: 'agent-1',
    agent_name: 'Security Reviewer',
    status: 'done',
    findings: [],
    ...overrides,
  };
}

describe('multi-agent-derive: deriveFindingGroups (AC-22..AC-25, E-10, E-11, E-12)', () => {
  it('AC-22: groups findings across runs when file + category match and ranges overlap after ±3 expansion', () => {
    const a = finding({ id: 'a', run_id: 'r1', agent_id: 'ag1', agent_name: 'Security', start_line: 10, end_line: 10 });
    const b = finding({ id: 'b', run_id: 'r2', agent_id: 'ag2', agent_name: 'Performance', start_line: 13, end_line: 13 });
    const runs = [run({ run_id: 'r1', agent_id: 'ag1', agent_name: 'Security', findings: [a] }), run({ run_id: 'r2', agent_id: 'ag2', agent_name: 'Performance', findings: [b] })];

    const groups = deriveFindingGroups(runs);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.members.map((m) => m.id).sort()).toEqual(['a', 'b']);
  });

  it('E-10: a finding spanning >20 lines is never expanded — a nearby finding just out of its EXACT range is not grouped with it', () => {
    // Wide finding spans 25 lines (>20) — per AC-22/E-10 it contributes only
    // its exact [1,25] range, no ±3 expansion of its own. A narrow finding at
    // line 30 expands to [27,33] — still short of the wide finding's exact
    // upper bound (25), so the two must NOT group. (Had the wide finding also
    // been expanded ±3 as if it were narrow, its range would reach 28 and
    // WOULD overlap [27,33] — this test would then fail, which is exactly
    // the regression E-10 exists to catch.)
    const wide = finding({ id: 'wide', run_id: 'r1', agent_id: 'ag1', start_line: 1, end_line: 25 });
    const narrow = finding({ id: 'narrow', run_id: 'r2', agent_id: 'ag2', start_line: 30, end_line: 30 });
    const runs = [
      run({ run_id: 'r1', agent_id: 'ag1', findings: [wide] }),
      run({ run_id: 'r2', agent_id: 'ag2', findings: [narrow] }),
    ];

    const groups = deriveFindingGroups(runs);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.members.length === 1)).toBe(true);
  });

  it('AC-24: a multi-agent group retains each agent\'s own title/rationale/suggestion/confidence verbatim (no merge/paraphrase)', () => {
    const a = finding({
      id: 'a',
      run_id: 'r1',
      agent_id: 'ag1',
      agent_name: 'Security Reviewer',
      title: 'Hardcoded secret',
      rationale: 'A live key is committed.',
      suggestion: 'Move it to env.',
      confidence: 0.9,
    });
    const b = finding({
      id: 'b',
      run_id: 'r2',
      agent_id: 'ag2',
      agent_name: 'Performance Reviewer',
      title: 'Suspicious literal',
      rationale: 'This value looks sensitive and inefficiently duplicated.',
      suggestion: null,
      confidence: 0.4,
    });
    const runs = [run({ run_id: 'r1', agent_id: 'ag1', findings: [a] }), run({ run_id: 'r2', agent_id: 'ag2', findings: [b] })];

    const [group] = deriveFindingGroups(runs);
    expect(group!.members).toHaveLength(2);
    const byAgent = Object.fromEntries(group!.members.map((m) => [m.agent_id, m]));
    expect(byAgent['ag1']).toMatchObject({
      title: 'Hardcoded secret',
      rationale: 'A live key is committed.',
      suggestion: 'Move it to env.',
      confidence: 0.9,
    });
    expect(byAgent['ag2']).toMatchObject({
      title: 'Suspicious literal',
      rationale: 'This value looks sensitive and inefficiently duplicated.',
      suggestion: null,
      confidence: 0.4,
    });
  });

  it('AC-25: a finding flagged by exactly one agent is still emitted, as a group of one', () => {
    const only = finding({ id: 'solo' });
    const groups = deriveFindingGroups([run({ findings: [only] })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.members).toHaveLength(1);
    expect(groups[0]!.members[0]!.id).toBe('solo');
  });

  it('AC-23: derivation is a pure read — never mutates the input findings array or its finding objects', () => {
    const a = finding({ id: 'a' });
    const b = finding({ id: 'b', run_id: 'r2', agent_id: 'ag2' });
    const runs = [run({ run_id: 'r1', findings: [a] }), run({ run_id: 'r2', agent_id: 'ag2', findings: [b] })];
    // Deep-freeze every finding + its owning findings array; a mutation
    // attempt would throw (strict-mode ESM) rather than silently succeed.
    Object.freeze(a);
    Object.freeze(b);
    Object.freeze(runs[0]!.findings);
    Object.freeze(runs[1]!.findings);
    Object.freeze(runs[0]);
    Object.freeze(runs[1]);

    expect(() => deriveFindingGroups(runs)).not.toThrow();
    expect(() => deriveConflicts(runs)).not.toThrow();
    // Originals still intact / referentially the same objects afterward.
    expect(runs[0]!.findings[0]).toBe(a);
    expect(a.title).toBe('title');
  });

  it('E-11 (grouping half): same file + same line but DIFFERENT category are NOT grouped', () => {
    const sec = finding({ id: 'sec', run_id: 'r1', agent_id: 'ag1', category: 'security', start_line: 20, end_line: 20 });
    const perf = finding({ id: 'perf', run_id: 'r2', agent_id: 'ag2', category: 'perf', start_line: 20, end_line: 20 });
    const runs = [run({ run_id: 'r1', agent_id: 'ag1', findings: [sec] }), run({ run_id: 'r2', agent_id: 'ag2', findings: [perf] })];

    const groups = deriveFindingGroups(runs);
    expect(groups).toHaveLength(2);
  });

  it('E-11 (conflict half): the SAME same-line/different-category pair DOES appear as one shared location for conflicts', () => {
    const sec = finding({ id: 'sec', run_id: 'r1', agent_id: 'ag1', category: 'security', start_line: 20, end_line: 20 });
    const perf = finding({ id: 'perf', run_id: 'r2', agent_id: 'ag2', category: 'perf', start_line: 20, end_line: 20 });
    const runs = [run({ run_id: 'r1', agent_id: 'ag1', findings: [sec] }), run({ run_id: 'r2', agent_id: 'ag2', findings: [perf] })];

    const conflicts = deriveConflicts(runs);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.takes).toHaveLength(2);
  });

  it('E-12: `./src/x.ts` and `src/x.ts` are treated as the same file for grouping', () => {
    const a = finding({ id: 'a', run_id: 'r1', agent_id: 'ag1', file: './src/x.ts', start_line: 5, end_line: 5 });
    const b = finding({ id: 'b', run_id: 'r2', agent_id: 'ag2', file: 'src/x.ts', start_line: 5, end_line: 5 });
    const runs = [run({ run_id: 'r1', agent_id: 'ag1', findings: [a] }), run({ run_id: 'r2', agent_id: 'ag2', findings: [b] })];

    const groups = deriveFindingGroups(runs);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.members).toHaveLength(2);
    expect(normalizeFilePath('./src/x.ts')).toBe(normalizeFilePath('src/x.ts'));
  });
});

describe('multi-agent-derive: deriveConflicts (AC-27..AC-31 unfiltered emission, D-14)', () => {
  it('AC-28: an agent that completed successfully but did not flag a shared location is included as an \'ignored\' take carrying a note', () => {
    const flagged = finding({ id: 'f1', run_id: 'r1', agent_id: 'ag1', agent_name: 'Security', start_line: 40, end_line: 40 });
    const runs = [
      run({ run_id: 'r1', agent_id: 'ag1', agent_name: 'Security', findings: [flagged] }),
      run({ run_id: 'r2', agent_id: 'ag2', agent_name: 'Performance', status: 'done', findings: [] }),
    ];

    const conflicts = deriveConflicts(runs);
    expect(conflicts).toHaveLength(1);
    const takeByAgent = Object.fromEntries(conflicts[0]!.takes.map((t) => [t.agent_id, t]));
    expect(takeByAgent['ag1']!.verdict).toBe('WARNING');
    expect(takeByAgent['ag2']!.verdict).toBe('ignored');
    expect(takeByAgent['ag2']!.note).toBeTruthy();
  });

  it("AC-29: a FAILED run contributes NO take at any location — not even 'ignored'", () => {
    const flagged = finding({ id: 'f1', run_id: 'r1', agent_id: 'ag1', start_line: 40, end_line: 40 });
    const runs = [
      run({ run_id: 'r1', agent_id: 'ag1', findings: [flagged] }),
      run({ run_id: 'r2', agent_id: 'ag2', status: 'failed', findings: [] }),
      run({ run_id: 'r3', agent_id: 'ag3', agent_name: 'Third', status: 'done', findings: [] }),
    ];

    const conflicts = deriveConflicts(runs);
    expect(conflicts).toHaveLength(1);
    const agentIds = conflicts[0]!.takes.map((t) => t.agent_id);
    expect(agentIds).not.toContain('ag2');
    expect(agentIds.sort()).toEqual(['ag1', 'ag3']);
  });

  it("AC-29: a CANCELLED run is likewise excluded from every take list", () => {
    const flagged = finding({ id: 'f1', run_id: 'r1', agent_id: 'ag1', start_line: 40, end_line: 40 });
    const runs = [
      run({ run_id: 'r1', agent_id: 'ag1', findings: [flagged] }),
      run({ run_id: 'r2', agent_id: 'ag2', status: 'cancelled', findings: [] }),
      run({ run_id: 'r3', agent_id: 'ag3', status: 'done', findings: [] }),
    ];

    const conflicts = deriveConflicts(runs);
    const agentIds = conflicts[0]!.takes.map((t) => t.agent_id);
    expect(agentIds).not.toContain('ag2');
  });

  it("E-13: a DONE run with ZERO findings still contributes an 'ignored' take at every other run's location", () => {
    const flagged = finding({ id: 'f1', run_id: 'r1', agent_id: 'ag1', start_line: 40, end_line: 40 });
    const runs = [
      run({ run_id: 'r1', agent_id: 'ag1', findings: [flagged] }),
      run({ run_id: 'r2', agent_id: 'ag2', status: 'done', findings: [] }),
    ];
    const conflicts = deriveConflicts(runs);
    expect(conflicts).toHaveLength(1);
    const zeroFindingTake = conflicts[0]!.takes.find((t) => t.agent_id === 'ag2');
    expect(zeroFindingTake?.verdict).toBe('ignored');
  });

  it('AC-30/AC-31 (current unfiltered contract): a location where every participating agent AGREES (same severity, nobody silent) is still emitted, not filtered out', () => {
    const a = finding({ id: 'a', run_id: 'r1', agent_id: 'ag1', severity: 'CRITICAL', start_line: 50, end_line: 50 });
    const b = finding({ id: 'b', run_id: 'r2', agent_id: 'ag2', severity: 'CRITICAL', start_line: 50, end_line: 50 });
    const runs = [run({ run_id: 'r1', agent_id: 'ag1', findings: [a] }), run({ run_id: 'r2', agent_id: 'ag2', findings: [b] })];

    // Under the OLD (AC-30-filtered) contract this location — no silent
    // agent, no severity divergence — would NOT be a "genuine conflict" and
    // could have been dropped. The CURRENT contract emits every shared
    // location unconditionally; the caller/client applies AC-30 as a filter.
    const conflicts = deriveConflicts(runs);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.takes.every((t) => t.verdict === 'CRITICAL')).toBe(true);
  });

  it('a single participating run has no "shared" location at all (conflicts requires ≥2 participants)', () => {
    const only = finding({ id: 'solo', run_id: 'r1', agent_id: 'ag1' });
    const conflicts = deriveConflicts([run({ run_id: 'r1', agent_id: 'ag1', findings: [only] })]);
    expect(conflicts).toEqual([]);
  });
});
