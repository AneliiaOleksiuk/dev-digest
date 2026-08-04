import { describe, it, expect } from "vitest";
import type { FindingRecord } from "@devdigest/shared";
import { findingsForLine, mostSevereFinding, severityCountsForFile } from "./findings";
import type { Line } from "./helpers";

function finding(overrides: Partial<FindingRecord>): FindingRecord {
  return {
    id: "f1",
    severity: "WARNING",
    category: "bug",
    title: "Some finding",
    file: "src/a.ts",
    start_line: 10,
    end_line: 12,
    rationale: "…",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...overrides,
  };
}

function addedLine(newNo: number): Line {
  return { kind: "add", text: "x", newNo };
}

describe("findingsForLine", () => {
  it("matches a finding whose [start_line, end_line] range covers this line", () => {
    const target = finding({ start_line: 10, end_line: 12 });
    expect(findingsForLine([target], "src/a.ts", addedLine(11))).toEqual([target]);
  });

  it("excludes findings on a different file", () => {
    const target = finding({ file: "src/other.ts", start_line: 10, end_line: 12 });
    expect(findingsForLine([target], "src/a.ts", addedLine(11))).toEqual([]);
  });

  it("excludes findings whose range doesn't cover this line", () => {
    const target = finding({ start_line: 10, end_line: 12 });
    expect(findingsForLine([target], "src/a.ts", addedLine(20))).toEqual([]);
  });

  it("falls back to start_line when end_line is missing (single-line finding)", () => {
    const target = finding({ start_line: 10, end_line: undefined });
    expect(findingsForLine([target], "src/a.ts", addedLine(10))).toEqual([target]);
    expect(findingsForLine([target], "src/a.ts", addedLine(11))).toEqual([]);
  });

  it("returns nothing for a hunk-header line (no new-side line number)", () => {
    const target = finding({ start_line: 10, end_line: 12 });
    expect(findingsForLine([target], "src/a.ts", { kind: "hunk", text: "@@ -1,2 +1,3 @@" })).toEqual([]);
  });
});

describe("mostSevereFinding", () => {
  it("picks CRITICAL over WARNING and SUGGESTION", () => {
    const critical = finding({ id: "c", severity: "CRITICAL" });
    const warning = finding({ id: "w", severity: "WARNING" });
    const suggestion = finding({ id: "s", severity: "SUGGESTION" });
    expect(mostSevereFinding([suggestion, warning, critical])?.id).toBe("c");
  });
});

describe("severityCountsForFile", () => {
  it("tallies per-severity counts for one file, ignoring other files", () => {
    const findings = [
      finding({ severity: "CRITICAL", file: "src/a.ts" }),
      finding({ severity: "CRITICAL", file: "src/a.ts" }),
      finding({ severity: "WARNING", file: "src/a.ts" }),
      finding({ severity: "SUGGESTION", file: "src/other.ts" }),
    ];
    expect(severityCountsForFile(findings, "src/a.ts")).toEqual({ CRITICAL: 2, WARNING: 1 });
  });
});
