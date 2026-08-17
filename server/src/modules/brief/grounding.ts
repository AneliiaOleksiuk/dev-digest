import type { Brief, ReviewFocusItem, Risk, UnifiedDiff } from '@devdigest/shared';
import { MAX_FOCUS_ITEMS, MAX_RISKS } from './constants.js';

/**
 * Grounding — the model phrases, never invents (AC-18–AC-21). Mirrors
 * `reviewer-core/src/grounding.ts`'s `buildLineIndex` rule EXACTLY, including
 * the `newLineNumbers`-empty → `[newStart, newStart + max(newLines, 1))`
 * fallback — that file's own `groundFindings` cannot be reused as-is (E-9:
 * its signature is `(Finding[], UnifiedDiff)`, Brief's items are not
 * `Finding`s, and `buildLineIndex` isn't re-exported by the package barrel
 * or `platform/grounding.ts`'s re-export shim). So the rule is mirrored
 * locally rather than imported — same discard contract
 * (`groundFindings`/`ConventionsService.groundCandidates`,
 * `conventions/service.ts:139-166`): drop, never repair.
 */

export interface GroundBriefResult {
  brief: Brief;
  droppedRiskRefs: number;
  droppedFocusItems: number;
}

/** Build a `path → Set<new-side line numbers covered by a hunk>` index from
 *  the FULL diff (E-10 — the model never saw this, grounding may and should
 *  use it). */
function buildLineIndex(diff: UnifiedDiff): Map<string, Set<number>> {
  const idx = new Map<string, Set<number>>();
  for (const f of diff.files) {
    const set = new Set<number>();
    for (const h of f.hunks) {
      if (h.newLineNumbers && h.newLineNumbers.length > 0) {
        for (const n of h.newLineNumbers) set.add(n);
      } else {
        for (let n = h.newStart; n < h.newStart + Math.max(h.newLines, 1); n++) set.add(n);
      }
    }
    idx.set(f.path, set);
  }
  return idx;
}

/**
 * AC-18: drop each `risks[].file_refs` path not in the changed-file set —
 * the risk itself is KEPT even if its refs empty out entirely (worded that
 * way in AC-18; the risk's `explanation`/`title` still stand on their own).
 */
function groundRisk(risk: Risk, filesInDiff: Set<string>): Risk {
  return { ...risk, file_refs: risk.file_refs.filter((path) => filesInDiff.has(path)) };
}

/**
 * AC-19/E-8: drop a `review_focus[]` entry whose path is unknown OR whose
 * line falls outside every changed hunk range for that file — the sharper,
 * more insidious case: a real file with a line outside the diff still
 * produces a working (but misleading) link.
 */
function isGroundedFocusItem(item: ReviewFocusItem, lineIndex: Map<string, Set<number>>): boolean {
  const lines = lineIndex.get(item.path);
  return lines != null && lines.has(item.line);
}

export function groundBrief(
  raw: { what: string; why: string; risk_level: Brief['risk_level']; risks: Risk[]; review_focus: ReviewFocusItem[] },
  diff: UnifiedDiff,
): GroundBriefResult {
  const filesInDiff = new Set(diff.files.map((f) => f.path));
  const lineIndex = buildLineIndex(diff);

  // Grounding-drop counts (AC-22) are measured BEFORE the MAX_RISKS/
  // MAX_FOCUS_ITEMS render cap below — a count over the model's ask is a
  // separate concern from a citation that failed to ground.
  const riskRefsBefore = raw.risks.reduce((n, r) => n + r.file_refs.length, 0);
  const groundedRisksAll = raw.risks.map((r) => groundRisk(r, filesInDiff));
  const riskRefsAfter = groundedRisksAll.reduce((n, r) => n + r.file_refs.length, 0);
  const droppedRiskRefs = riskRefsBefore - riskRefsAfter;
  const groundedRisks = groundedRisksAll.slice(0, MAX_RISKS);

  const groundedFocusAll = raw.review_focus.filter((item) => isGroundedFocusItem(item, lineIndex));
  const droppedFocusItems = raw.review_focus.length - groundedFocusAll.length;
  const groundedFocus = groundedFocusAll.slice(0, MAX_FOCUS_ITEMS);

  // AC-21: empty results are valid output, never a failure — no fallback,
  // no fabricated entry, just an honestly empty list.
  const brief: Brief = {
    what: raw.what,
    why: raw.why,
    risk_level: raw.risk_level,
    risks: groundedRisks,
    review_focus: groundedFocus,
  };

  return { brief, droppedRiskRefs, droppedFocusItems };
}
