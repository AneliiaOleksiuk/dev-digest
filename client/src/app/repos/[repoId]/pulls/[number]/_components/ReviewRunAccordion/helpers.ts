import type { FindingRecord } from "@devdigest/shared";
import type { SeverityCounts } from "@/components/severity-badge-button";

/** One pass over a run's findings: per-severity counts + the blocker count
 *  (unresolved CRITICAL findings). */
export function summarizeFindings(findings: FindingRecord[]): { counts: SeverityCounts; blockers: number } {
  const counts: SeverityCounts = {};
  let blockers = 0;
  for (const { severity, dismissed_at } of findings) {
    counts[severity] = (counts[severity] ?? 0) + 1;
    if (severity === "CRITICAL" && !dismissed_at) blockers += 1;
  }
  return { counts, blockers };
}
