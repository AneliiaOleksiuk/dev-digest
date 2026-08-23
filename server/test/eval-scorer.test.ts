import { describe, it, expect } from 'vitest';
import type { EvalExpectation } from '@devdigest/shared';
import {
  matchesExpectation,
  scoreCase,
  aggregateBatch,
  type FindingLocation,
  type EvalCaseOutcome,
} from '../src/modules/eval/scorer.js';

/**
 * WI6 — the pure scorer (`docs/plans/eval-pipeline.md` Phase B, "The pure
 * scorer"). Oracle: `specs/eval-pipeline.md` AC-23 through AC-30 plus D-5/Q-1
 * (precision's exact denominator) and E-6 (findings_total stays visible even
 * when precision doesn't move). No DB, no provider — every fixture here is a
 * plain object, matching the plan's own Definition of done for this item.
 *
 * Derived from the plan/spec BEFORE reading `scorer.ts` for anything beyond
 * exact function/type names — see the header note at the top of this file's
 * companion Test Report.
 */

function entry(
  overrides: Partial<{
    file: string;
    start_line: number;
    end_line: number;
    match_scope: 'range' | 'file';
  }> = {},
) {
  return {
    file: 'src/config.ts',
    start_line: 10,
    end_line: 12,
    match_scope: 'range' as const,
    ...overrides,
  };
}

function finding(overrides: Partial<FindingLocation> = {}): FindingLocation {
  return { file: 'src/config.ts', start_line: 10, end_line: 12, ...overrides };
}

function expectation(
  mustFind: ReturnType<typeof entry>[] = [],
  mustNotFlag: ReturnType<typeof entry>[] = [],
): EvalExpectation {
  return { version: 1, must_find: mustFind, must_not_flag: mustNotFlag };
}

describe('matchesExpectation — AC-23, Q-6', () => {
  it('same file + overlapping ranges → match', () => {
    // AC-23: finding.file === expectation.file AND ranges intersect.
    expect(
      matchesExpectation(finding({ start_line: 11, end_line: 11 }), entry({ start_line: 10, end_line: 12 })),
    ).toBe(true);
  });

  it('same file + non-overlapping ranges + match_scope: "range" → no match', () => {
    expect(
      matchesExpectation(
        finding({ start_line: 50, end_line: 50 }),
        entry({ start_line: 10, end_line: 12, match_scope: 'range' }),
      ),
    ).toBe(false);
  });

  it('same file + non-overlapping ranges + match_scope: "file" → match (Q-6 full-file exemption)', () => {
    // Q-6: secret_leak/lethal_trifecta/phantom/hook expectations skip the
    // line-range check entirely once match_scope is 'file'.
    expect(
      matchesExpectation(
        finding({ start_line: 50, end_line: 50 }),
        entry({ start_line: 10, end_line: 12, match_scope: 'file' }),
      ),
    ).toBe(true);
  });

  it('different file, same/overlapping lines → no match', () => {
    expect(
      matchesExpectation(
        finding({ file: 'src/other.ts', start_line: 11, end_line: 11 }),
        entry({ file: 'src/config.ts', start_line: 10, end_line: 12 }),
      ),
    ).toBe(false);
  });
});

describe('scoreCase — recall (AC-24)', () => {
  it('recall = share of must_find matched by >=1 grounded finding', () => {
    const exp = expectation([entry({ start_line: 10, end_line: 12 }), entry({ file: 'src/b.ts', start_line: 1, end_line: 1 })]);
    const result = scoreCase({
      expectation: exp,
      grounded: [finding({ start_line: 11, end_line: 11 })], // matches only the first must_find
      droppedCount: 0,
    });
    expect(result.recall).toBe(0.5);
  });

  it('recall is null (not 1.0 or 0) when there are zero must_find entries', () => {
    const exp = expectation([], [entry()]);
    const result = scoreCase({ expectation: exp, grounded: [], droppedCount: 0 });
    expect(result.recall).toBeNull();
  });
});

describe('scoreCase — precision (AC-25, D-5, Q-1)', () => {
  it('precision = TP / (TP + FP) over annotated regions only', () => {
    const exp = expectation(
      [entry({ start_line: 10, end_line: 12 })], // must_find
      [entry({ file: 'src/bad.ts', start_line: 1, end_line: 1 })], // must_not_flag
    );
    const result = scoreCase({
      expectation: exp,
      grounded: [
        finding({ start_line: 11, end_line: 11 }), // TP
        finding({ file: 'src/bad.ts', start_line: 1, end_line: 1 }), // FP
      ],
      droppedCount: 0,
    });
    expect(result.precision).toBe(0.5); // 1 TP / (1 TP + 1 FP)
  });

  it('a finding matching NEITHER list is excluded from precision\'s denominator — this is D-5\'s exact denominator, not "all findings"', () => {
    // One must_find (unmatched), one must_not_flag (unmatched), plus one
    // finding that hits neither list. Under D-5/Q-1's TP/(TP+FP) over
    // ANNOTATED regions only, TP=0 and FP=0, so precision is null — NOT
    // 0/1 (which is what a WIDER "all findings" denominator would compute).
    // A test that would pass under either denominator would not actually
    // prove this decision; asserting `null` here (not `0`) is what does.
    const exp = expectation(
      [entry({ file: 'src/never-found.ts', start_line: 1, end_line: 1 })],
      [entry({ file: 'src/never-flagged.ts', start_line: 1, end_line: 1 })],
    );
    const result = scoreCase({
      expectation: exp,
      grounded: [finding({ file: 'src/unrelated.ts', start_line: 5, end_line: 5 })],
      droppedCount: 0,
    });
    expect(result.precision).toBeNull();
  });

  it('precision is null when TP + FP === 0 (the all-unjudged case)', () => {
    const exp = expectation([entry({ file: 'src/never.ts', start_line: 1, end_line: 1 })], []);
    const result = scoreCase({
      expectation: exp,
      grounded: [finding({ file: 'src/other.ts', start_line: 99, end_line: 99 })],
      droppedCount: 0,
    });
    expect(result.precision).toBeNull();
  });
});

describe('scoreCase — citation_accuracy (AC-27, AC-28)', () => {
  it('citation_accuracy = kept / (kept + dropped)', () => {
    const exp = expectation([entry()], []);
    const result = scoreCase({
      expectation: exp,
      grounded: [finding({ start_line: 11, end_line: 11 })], // 1 kept
      droppedCount: 3, // 3 dropped pre-gate
    });
    expect(result.citation_accuracy).toBe(0.25); // 1 / (1 + 3)
  });

  it('citation_accuracy is null (not 1.0) when the run produced zero findings total', () => {
    const exp = expectation([entry()], []);
    const result = scoreCase({ expectation: exp, grounded: [], droppedCount: 0 });
    expect(result.citation_accuracy).toBeNull();
  });

  it('AC-28 ordering: a finding dropped by grounding lowers citation_accuracy without counting toward recall', () => {
    const exp = expectation([entry({ start_line: 10, end_line: 12 })], []);
    // The dropped finding never appears in `grounded` — it can only ever
    // affect citation_accuracy via droppedCount, never recall/precision.
    const result = scoreCase({
      expectation: exp,
      grounded: [], // the must_find was NOT matched post-gate
      droppedCount: 1,
    });
    expect(result.recall).toBe(0); // present (must_find.length > 0) but unmatched
    expect(result.citation_accuracy).toBe(0); // 0 kept / (0 kept + 1 dropped)
  });
});

describe('scoreCase — pass (AC-29)', () => {
  it('pass: true when every must_find matched AND zero must_not_flag matches', () => {
    const exp = expectation(
      [entry({ start_line: 10, end_line: 12 })],
      [entry({ file: 'src/bad.ts', start_line: 1, end_line: 1 })],
    );
    const result = scoreCase({
      expectation: exp,
      grounded: [finding({ start_line: 11, end_line: 11 })],
      droppedCount: 0,
    });
    expect(result.pass).toBe(true);
  });

  it('pass: false when a must_find is unmatched (partial match)', () => {
    const exp = expectation([entry({ start_line: 10, end_line: 12 }), entry({ file: 'src/b.ts', start_line: 1, end_line: 1 })]);
    const result = scoreCase({
      expectation: exp,
      grounded: [finding({ start_line: 11, end_line: 11 })], // only the first matched
      droppedCount: 0,
    });
    expect(result.pass).toBe(false);
  });

  it('pass: false when a must_not_flag IS matched, even if every must_find matched', () => {
    const exp = expectation(
      [entry({ start_line: 10, end_line: 12 })],
      [entry({ file: 'src/bad.ts', start_line: 1, end_line: 1 })],
    );
    const result = scoreCase({
      expectation: exp,
      grounded: [
        finding({ start_line: 11, end_line: 11 }),
        finding({ file: 'src/bad.ts', start_line: 1, end_line: 1 }),
      ],
      droppedCount: 0,
    });
    expect(result.pass).toBe(false);
  });
});

describe('scoreCase — findings_total (AC-26, E-6)', () => {
  it('findings_total is the raw grounded count, including findings matching neither list, and moves even when precision does not', () => {
    const exp = expectation(
      [entry({ start_line: 10, end_line: 12 })],
      [entry({ file: 'src/bad.ts', start_line: 1, end_line: 1 })],
    );
    const baseline = scoreCase({
      expectation: exp,
      grounded: [
        finding({ start_line: 11, end_line: 11 }), // TP
        finding({ file: 'src/bad.ts', start_line: 1, end_line: 1 }), // FP
      ],
      droppedCount: 0,
    });

    // An agent that sprays 5 unannotated extra findings outside every
    // annotated region — E-6's dilution blind spot: precision must NOT move,
    // but findings_total must.
    const sprayed = scoreCase({
      expectation: exp,
      grounded: [
        finding({ start_line: 11, end_line: 11 }),
        finding({ file: 'src/bad.ts', start_line: 1, end_line: 1 }),
        finding({ file: 'src/noise1.ts', start_line: 1, end_line: 1 }),
        finding({ file: 'src/noise2.ts', start_line: 1, end_line: 1 }),
        finding({ file: 'src/noise3.ts', start_line: 1, end_line: 1 }),
        finding({ file: 'src/noise4.ts', start_line: 1, end_line: 1 }),
        finding({ file: 'src/noise5.ts', start_line: 1, end_line: 1 }),
      ],
      droppedCount: 0,
    });

    expect(baseline.findings_total).toBe(2);
    expect(sprayed.findings_total).toBe(7);
    expect(sprayed.precision).toBe(baseline.precision); // unchanged despite the noise
  });
});

describe('aggregateBatch — AC-30, AC-21', () => {
  function outcome(overrides: Partial<EvalCaseOutcome> = {}): EvalCaseOutcome {
    return { ok: true, pass: true, recall: 1, precision: 1, citation_accuracy: 1, ...overrides };
  }

  it('unweighted mean over non-null values only, with the correct contributing count per metric — 2 of 8 is distinguishable from 8 of 8', () => {
    const cases: EvalCaseOutcome[] = [
      outcome({ recall: 1, precision: null, citation_accuracy: 0.5 }),
      outcome({ recall: 0, precision: null, citation_accuracy: 0.5 }),
      outcome({ recall: null, precision: null, citation_accuracy: 0.5 }),
      outcome({ recall: null, precision: null, citation_accuracy: 0.5 }),
      outcome({ recall: null, precision: null, citation_accuracy: 0.5 }),
      outcome({ recall: null, precision: null, citation_accuracy: 0.5 }),
      outcome({ recall: null, precision: null, citation_accuracy: 0.5 }),
      outcome({ recall: null, precision: null, citation_accuracy: 0.5 }),
    ];
    const agg = aggregateBatch(cases);

    // recall: only 2 of 8 cases had a non-null recall (mean of 1 and 0 = 0.5).
    expect(agg.recall).toBe(0.5);
    expect(agg.recall_cases).toBe(2);
    // precision: 0 of 8 contributed → null mean, 0 count — distinct from the
    // recall row's "2 of 8", not conflated into the same reading.
    expect(agg.precision).toBeNull();
    expect(agg.precision_cases).toBe(0);
    // citation_accuracy: all 8 contributed.
    expect(agg.citation_accuracy).toBe(0.5);
    expect(agg.citation_cases).toBe(8);
  });

  it('an all-failed batch (every case errored) → status "failed", every metric null, NEVER zero', () => {
    const cases: EvalCaseOutcome[] = [
      { ok: false, pass: null, recall: null, precision: null, citation_accuracy: null },
      { ok: false, pass: null, recall: null, precision: null, citation_accuracy: null },
      { ok: false, pass: null, recall: null, precision: null, citation_accuracy: null },
    ];
    const agg = aggregateBatch(cases);

    expect(agg.status).toBe('failed');
    expect(agg.recall).toBeNull();
    expect(agg.precision).toBeNull();
    expect(agg.citation_accuracy).toBeNull();
    // Explicitly NOT zero — a flattened 0 would misread as "the agent scored
    // zero" rather than "nothing executed" (AC-21).
    expect(agg.recall).not.toBe(0);
    expect(agg.precision).not.toBe(0);
    expect(agg.citation_accuracy).not.toBe(0);
    expect(agg.recall_cases).toBe(0);
    expect(agg.precision_cases).toBe(0);
    expect(agg.citation_cases).toBe(0);
  });

  it('an all-succeeded, all-passing batch → status "completed"', () => {
    const cases: EvalCaseOutcome[] = [outcome(), outcome(), outcome()];
    const agg = aggregateBatch(cases);
    expect(agg.status).toBe('completed');
    expect(agg.cases_passed).toBe(3);
    expect(agg.cases_failed).toBe(0);
  });
});
