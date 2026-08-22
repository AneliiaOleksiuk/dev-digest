import type { EvalExpectation, EvalExpectationEntry } from '@devdigest/shared';

/**
 * The pure scorer (WI6). Imports NOTHING beyond this module and the shared
 * contract TYPES (type-only — zero runtime dependency on `db/`, `adapters/`,
 * or `platform/`) — every function here is a pure function over plain
 * inputs, unit-testable with no database and no provider.
 *
 * ORDERING (AC-28 — easy to get backwards, so it's stated explicitly here):
 *   `recall`/`precision` are computed over the GROUNDED (post-grounding-gate)
 *   finding set — the `grounded` array below.
 *   `citation_accuracy` is computed over the PRE-GATE set, via `droppedCount`
 *   — the grounding gate's OWN drop count, passed in by the caller. This
 *   file never re-implements grounding; it only consumes the count
 *   `reviewer-core`'s `groundFindings` already produced (AC-17, AC-27 — a
 *   second grounding implementation is forbidden).
 */

/** The only shape `matchesExpectation`/`scoreCase` need from a finding —
 *  deliberately narrower than the full `Finding` contract so a test fixture
 *  never needs more than these three fields. A real `Finding` is always
 *  structurally assignable to this. */
export interface FindingLocation {
  file: string;
  start_line: number;
  end_line: number;
}

/**
 * `matchesExpectation` — AC-23 + Q-6. True iff the finding's file matches
 * the expectation entry's file AND EITHER the entry's `match_scope` is
 * `'file'` (Q-6's full-file exemption — no line-range check at all) OR the
 * two `[start_line, end_line]` ranges intersect.
 */
export function matchesExpectation(
  finding: FindingLocation,
  expectation: Pick<EvalExpectationEntry, 'file' | 'start_line' | 'end_line' | 'match_scope'>,
): boolean {
  if (finding.file !== expectation.file) return false;
  if (expectation.match_scope === 'file') return true;
  return rangesIntersect(
    finding.start_line,
    finding.end_line,
    expectation.start_line,
    expectation.end_line,
  );
}

function rangesIntersect(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  const aLo = Math.min(aStart, aEnd);
  const aHi = Math.max(aStart, aEnd);
  const bLo = Math.min(bStart, bEnd);
  const bHi = Math.max(bStart, bEnd);
  return aLo <= bHi && bLo <= aHi;
}

export interface ScoreCaseInput {
  expectation: EvalExpectation;
  /** Findings that SURVIVED the grounding gate (post-gate) — `recall` and
   *  `precision` are computed over this set (AC-28). */
  grounded: FindingLocation[];
  /** How many findings the grounding gate DROPPED. Pre-gate total =
   *  `grounded.length + droppedCount` — `citation_accuracy` is computed from
   *  THAT total (AC-28). This file never re-runs grounding; it only
   *  consumes the count. */
  droppedCount: number;
}

export interface ScoreCaseResult {
  recall: number | null;
  precision: number | null;
  citation_accuracy: number | null;
  pass: boolean;
  findings_total: number;
}

/**
 * `scoreCase` — AC-24, AC-25, AC-26, AC-27, AC-29 (D-5/Q-1 binding for
 * precision's denominator — see the comment at that line, do not "improve"
 * it to include all findings without a new, deliberate plan decision).
 */
export function scoreCase({ expectation, grounded, droppedCount }: ScoreCaseInput): ScoreCaseResult {
  const mustFind = expectation.must_find;
  const mustNotFlag = expectation.must_not_flag;

  // recall — share of must_find entries matched by >=1 grounded finding.
  // null (NOT 1.0) when there are zero must_find entries (AC-24) — an
  // expectation with no must_find assertions has nothing to measure recall
  // against, so a perfect score would be a lie.
  const recall =
    mustFind.length === 0
      ? null
      : mustFind.filter((entry) => grounded.some((f) => matchesExpectation(f, entry))).length /
        mustFind.length;

  // precision = TP / (TP + FP), computed ONLY over annotated regions (D-5,
  // Q-1 — this exact denominator was a deliberate, binding plan decision;
  // changing it is a one-line edit with a failing unit test to guide it, not
  // a drive-by "improvement" here). TP = grounded findings matching >=1
  // must_find entry; FP = grounded findings matching >=1 must_not_flag
  // entry. A grounded finding matching NEITHER list is excluded from both
  // terms — it still counts toward `findings_total` below, which is what
  // keeps the "agent sprays extra unannotated findings" blind spot at least
  // visible even though it doesn't move precision (AC-26, E-6).
  let tp = 0;
  let fp = 0;
  for (const finding of grounded) {
    const hitsMustFind = mustFind.some((entry) => matchesExpectation(finding, entry));
    const hitsMustNotFlag = mustNotFlag.some((entry) => matchesExpectation(finding, entry));
    if (hitsMustFind) tp++;
    else if (hitsMustNotFlag) fp++;
  }
  const precision = tp + fp === 0 ? null : tp / (tp + fp);

  // citation_accuracy = kept / (kept + dropped), from the PRE-GATE set (see
  // the module header comment on ordering) — null when the run produced NO
  // findings at all, kept or dropped (AC-27).
  const kept = grounded.length;
  const citation_accuracy = kept + droppedCount === 0 ? null : kept / (kept + droppedCount);

  // pass = every must_find entry matched AND zero must_not_flag matches
  // (AC-29).
  const allMustFindMatched = mustFind.every((entry) =>
    grounded.some((f) => matchesExpectation(f, entry)),
  );
  const noMustNotFlagMatched = mustNotFlag.every(
    (entry) => !grounded.some((f) => matchesExpectation(f, entry)),
  );
  const pass = allMustFindMatched && noMustNotFlagMatched;

  // findings_total = the raw count of ALL grounded findings, including ones
  // matching neither list (AC-26, E-6) — the SAME set precision's TP/FP
  // walks, not the pre-gate set (that's what citation_accuracy is for).
  const findings_total = grounded.length;

  return { recall, precision, citation_accuracy, pass, findings_total };
}

/**
 * One case's contribution to a batch aggregate (WI7/Phase C constructs
 * these; this module only consumes the shape).
 */
export interface EvalCaseOutcome {
  /** `false` when the case FAILED TO EXECUTE at all — provider error,
   *  unparseable diff, schema-invalid response, or a `withTimeout` expiry
   *  (AC-20). Distinct from `pass: false`, which is a real score that DID
   *  execute and simply didn't match. An errored case contributes to
   *  `cases_failed` below but NEVER to any per-metric mean — it produced no
   *  score to average in. */
  ok: boolean;
  pass: boolean | null;
  recall: number | null;
  precision: number | null;
  citation_accuracy: number | null;
}

export interface BatchAggregate {
  /** AC-21 — an all-cases-failed batch (nothing executed successfully)
   *  reports `'failed'` with every metric `null`, never zeros. An empty
   *  batch (`caseResults.length === 0`) is treated the same way — there is
   *  nothing to report as `'completed'`. */
  status: 'completed' | 'failed';
  cases_total: number;
  cases_passed: number;
  /** Not the same set as "errored" — includes both errored cases AND cases
   *  that ran but scored `pass: false` (batch-level pass/fail, matching
   *  `EvalBatchRecord.cases_failed`'s own contract meaning). */
  cases_failed: number;
  recall: number | null;
  /** Contributing case count for `recall` (AC-30 — "2 of 8" must be
   *  distinguishable from "8 of 8"). */
  recall_cases: number;
  precision: number | null;
  precision_cases: number;
  citation_accuracy: number | null;
  citation_cases: number;
}

/**
 * `aggregateBatch` — AC-30, AC-21. Unweighted mean over NON-NULL per-case
 * values, per metric, plus the count of cases that actually contributed to
 * each mean.
 */
export function aggregateBatch(caseResults: EvalCaseOutcome[]): BatchAggregate {
  const cases_total = caseResults.length;
  const cases_passed = caseResults.filter((c) => c.ok && c.pass === true).length;
  const cases_failed = cases_total - cases_passed;

  const meanOf = (pick: (c: EvalCaseOutcome) => number | null): { mean: number | null; count: number } => {
    const values = caseResults
      .filter((c) => c.ok)
      .map(pick)
      .filter((v): v is number => v !== null);
    if (values.length === 0) return { mean: null, count: 0 };
    return { mean: values.reduce((a, b) => a + b, 0) / values.length, count: values.length };
  };

  const recallAgg = meanOf((c) => c.recall);
  const precisionAgg = meanOf((c) => c.precision);
  const citationAgg = meanOf((c) => c.citation_accuracy);

  const anyOk = caseResults.some((c) => c.ok);

  return {
    status: anyOk ? 'completed' : 'failed',
    cases_total,
    cases_passed,
    cases_failed,
    recall: recallAgg.mean,
    recall_cases: recallAgg.count,
    precision: precisionAgg.mean,
    precision_cases: precisionAgg.count,
    citation_accuracy: citationAgg.mean,
    citation_cases: citationAgg.count,
  };
}
