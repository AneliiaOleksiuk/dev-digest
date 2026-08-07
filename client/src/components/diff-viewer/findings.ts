/* Findings-in-diff support for the DiffViewer (Files changed tab).
   Badge + row tint pin to the concrete *changed* line that cites the
   finding — prefer start_line when it is an added line in the patch, never
   the first/last line of the whole file diff by accident. */
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

/** New-side line numbers present in a parsed patch (add + context). */
export function newSideLineSet(lines: Line[]): Set<number> {
  const set = new Set<number>();
  for (const line of lines) {
    if (line.newNo != null) set.add(line.newNo);
  }
  return set;
}

/** Added (new-side) line numbers only — the lines a finding can "trigger" on. */
export function addedLineSet(lines: Line[]): Set<number> {
  const set = new Set<number>();
  for (const line of lines) {
    if (line.kind === "add" && line.newNo != null) set.add(line.newNo);
  }
  return set;
}

/**
 * Resolve a finding to the concrete added line that triggers it.
 * Prefer start_line (the cited trigger), then end_line, then the added line
 * in [start, end] closest to start_line. Falls back to any new-side line in
 * range only when no added line exists there.
 */
export function resolveFindingLine(
  addedLines: Set<number>,
  start: number,
  end: number,
  allNewSide?: Set<number>,
): number | null {
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);

  const pickClosest = (pool: Set<number>, target: number): number | null => {
    let best: number | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const n of pool) {
      if (n < lo || n > hi) continue;
      const dist = Math.abs(n - target);
      if (dist < bestDist) {
        bestDist = dist;
        best = n;
      }
    }
    return best;
  };

  if (addedLines.size > 0) {
    if (addedLines.has(start)) return start;
    if (addedLines.has(end)) return end;
    const nearStart = pickClosest(addedLines, start);
    if (nearStart != null) return nearStart;
  }

  const pool = allNewSide && allNewSide.size > 0 ? allNewSide : addedLines;
  if (pool.size === 0) return start;
  if (pool.has(start)) return start;
  if (pool.has(end)) return end;
  return pickClosest(pool, start);
}

/** Findings whose resolved trigger line equals this rendered line's newNo. */
export function findingsForLine(
  findings: FindingRecord[],
  filePath: string,
  line: Line,
  addedLines: Set<number>,
  allNewSide?: Set<number>,
): FindingRecord[] {
  const lineNumber = line.newNo;
  if (lineNumber == null) return [];
  return findings.filter((f) => {
    if (f.file !== filePath) return false;
    const resolved = resolveFindingLine(
      addedLines,
      f.start_line,
      f.end_line ?? f.start_line,
      allNewSide,
    );
    return resolved === lineNumber;
  });
}

/** Findings whose [start_line, end_line] range covers this line's new-side
 *  number — drives row tint across the whole cited span (not just the trigger). */
export function findingsCoveringLine(
  findings: FindingRecord[],
  filePath: string,
  line: Line,
): FindingRecord[] {
  const lineNumber = line.newNo;
  if (lineNumber == null) return [];
  return findings.filter((f) => {
    if (f.file !== filePath) return false;
    const lo = Math.min(f.start_line, f.end_line ?? f.start_line);
    const hi = Math.max(f.start_line, f.end_line ?? f.start_line);
    return lineNumber >= lo && lineNumber <= hi;
  });
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
