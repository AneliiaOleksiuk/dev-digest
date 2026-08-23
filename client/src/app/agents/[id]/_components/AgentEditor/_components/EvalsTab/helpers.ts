import type { EvalRunRecord } from "@/lib/types";
import type { EvalBatchDetail } from "@/lib/hooks/eval";

/**
 * Reconstructs each case's most recent run by walking an agent's recent
 * batches NEWEST FIRST (the order `EvalDashboard.recent_runs` already uses)
 * and taking the first run matching each `case_id`. The server has no
 * per-case-across-batches endpoint (see `hooks/eval.ts`'s `useEvalBatch` doc
 * comment) — this is the honest client-side reconstruction, bounded to
 * whichever batch ids the caller passed in (EvalsTab passes a capped recent
 * slice, not the agent's whole history).
 */
export function buildLastRunByCase(
  batchDetailsNewestFirst: (EvalBatchDetail | undefined)[],
): Map<string, EvalRunRecord> {
  const map = new Map<string, EvalRunRecord>();
  for (const detail of batchDetailsNewestFirst) {
    if (!detail) continue;
    for (const run of detail.runs) {
      if (!map.has(run.case_id)) map.set(run.case_id, run);
    }
  }
  return map;
}

/** `0..1` metric → whole-number percent string, or `null` through untouched
 *  (AC-24/25/27 — undefined stays undefined, never coerced to a number). */
export function pct(value: number | null | undefined): number | null {
  return value == null ? null : Math.round(value * 100);
}
