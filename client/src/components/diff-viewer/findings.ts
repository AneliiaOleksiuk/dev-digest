/* Findings-in-diff support for the DiffViewer (Files changed tab). Pure
   matchers, mirroring how comments.ts anchors GitHub review comments to a
   rendered line — here anchored to a FindingRecord's [start_line, end_line]
   range on its file. */
import type { FindingRecord } from "@devdigest/shared";
import type { SeverityCounts } from "../severity-badge-button";
import type { Line } from "./helpers";

/** Most-to-least severe, for picking one line marker color when several
 *  findings cover the same line. */
const SEVERITY_ORDER: Record<string, number> = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2, INFO: 3 };

/** The most severe finding among several covering the same line. */
export function mostSevereFinding(findings: FindingRecord[]): FindingRecord | undefined {
  return [...findings].sort(
    ({ severity: severityA }, { severity: severityB }) =>
      (SEVERITY_ORDER[severityA] ?? 9) - (SEVERITY_ORDER[severityB] ?? 9),
  )[0];
}

/** Findings whose [start_line, end_line] range covers this rendered line's
 *  new-side number (the only side findings are reported against). */
export function findingsForLine(findings: FindingRecord[], filePath: string, line: Line): FindingRecord[] {
  const lineNumber = line.newNo;
  if (lineNumber == null) return [];
  return findings.filter(
    ({ file, start_line, end_line }) =>
      file === filePath && lineNumber >= start_line && lineNumber <= (end_line ?? start_line),
  );
}

/** Per-severity finding counts for one file — drives the file header's badge row. */
export function severityCountsForFile(findings: FindingRecord[], filePath: string): SeverityCounts {
  const counts: SeverityCounts = {};
  for (const { file, severity } of findings) {
    if (file !== filePath) continue;
    counts[severity] = (counts[severity] ?? 0) + 1;
  }
  return counts;
}
