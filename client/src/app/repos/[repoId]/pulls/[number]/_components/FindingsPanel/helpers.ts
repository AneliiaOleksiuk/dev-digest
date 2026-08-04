import type { FindingRecord } from "@devdigest/shared";
import { LOW_CONFIDENCE_THRESHOLD, SEVERITY_ORDER } from "./constants";

/** Optionally drop low-confidence findings and sort by severity. */
export function visibleFindings(findings: FindingRecord[], hideLow: boolean): FindingRecord[] {
  const shown = hideLow
    ? findings.filter(({ confidence }) => confidence >= LOW_CONFIDENCE_THRESHOLD)
    : findings;
  return [...shown].sort(
    ({ severity: severityA }, { severity: severityB }) =>
      (SEVERITY_ORDER[severityA] ?? 9) - (SEVERITY_ORDER[severityB] ?? 9),
  );
}

/** Keep only findings matching a severity filter (no-op when severity is null). */
export function filterBySeverity(findings: FindingRecord[], severity: string | null): FindingRecord[] {
  return severity ? findings.filter((finding) => finding.severity === severity) : findings;
}
