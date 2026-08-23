import { describe, it, expect } from "vitest";
import type { FindingRecord } from "@devdigest/shared";
import {
  addedLineSet,
  findingsCoveringLine,
  findingsForLine,
  mostSevereFinding,
  newSideLineSet,
  resolveFindingLine,
  severityCountsForFile,
} from "./findings";
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

const ADDED = new Set([10, 11, 12, 20]);

describe("resolveFindingLine", () => {
  it("prefers start_line when it is an added line (the trigger citation)", () => {
    expect(resolveFindingLine(ADDED, 10, 12)).toBe(10);
  });

  it("falls back to end_line when start is not an added line", () => {
    expect(resolveFindingLine(new Set([11, 12]), 10, 12)).toBe(12);
  });

  it("picks the added line in-range closest to start when neither endpoint is added", () => {
    expect(resolveFindingLine(new Set([11]), 10, 12)).toBe(11);
  });

  it("does not jump to an unrelated first/last line outside the finding range", () => {
    // Whole-file added lines include 1 and 99, but the finding is 10–12.
    expect(resolveFindingLine(new Set([1, 10, 11, 12, 99]), 10, 12)).toBe(10);
  });

  it("returns null-safe fallback to start when no lines available", () => {
    expect(resolveFindingLine(new Set(), 10, 12)).toBe(10);
  });
});

describe("findingsForLine", () => {
  it("pins the badge to the trigger line (start when added), not every line in the span", () => {
    const target = finding({ start_line: 10, end_line: 12 });
    expect(findingsForLine([target], "src/a.ts", addedLine(10), ADDED)).toEqual([target]);
    expect(findingsForLine([target], "src/a.ts", addedLine(11), ADDED)).toEqual([]);
    expect(findingsForLine([target], "src/a.ts", addedLine(12), ADDED)).toEqual([]);
  });

  it("excludes findings on a different file", () => {
    const target = finding({ file: "src/other.ts", start_line: 10, end_line: 12 });
    expect(findingsForLine([target], "src/a.ts", addedLine(10), ADDED)).toEqual([]);
  });

  it("excludes findings whose range doesn't resolve onto this line", () => {
    const target = finding({ start_line: 10, end_line: 12 });
    expect(findingsForLine([target], "src/a.ts", addedLine(20), ADDED)).toEqual([]);
  });

  it("resolves a single-line finding to that line", () => {
    const target = finding({ start_line: 10, end_line: 10 });
    expect(findingsForLine([target], "src/a.ts", addedLine(10), ADDED)).toEqual([target]);
    expect(findingsForLine([target], "src/a.ts", addedLine(11), ADDED)).toEqual([]);
  });

  it("returns nothing for a hunk-header line (no new-side line number)", () => {
    const target = finding({ start_line: 10, end_line: 12 });
    expect(
      findingsForLine([target], "src/a.ts", { kind: "hunk", text: "@@ -1,2 +1,3 @@" }, ADDED),
    ).toEqual([]);
  });
});

describe("findingsCoveringLine", () => {
  it("covers every line within [start_line, end_line], not just the trigger", () => {
    const target = finding({ start_line: 10, end_line: 12 });
    expect(findingsCoveringLine([target], "src/a.ts", addedLine(10))).toEqual([target]);
    expect(findingsCoveringLine([target], "src/a.ts", addedLine(11))).toEqual([target]);
    expect(findingsCoveringLine([target], "src/a.ts", addedLine(12))).toEqual([target]);
  });

  it("excludes lines outside the range", () => {
    const target = finding({ start_line: 10, end_line: 12 });
    expect(findingsCoveringLine([target], "src/a.ts", addedLine(9))).toEqual([]);
    expect(findingsCoveringLine([target], "src/a.ts", addedLine(13))).toEqual([]);
  });

  it("excludes findings on a different file", () => {
    const target = finding({ file: "src/other.ts", start_line: 10, end_line: 12 });
    expect(findingsCoveringLine([target], "src/a.ts", addedLine(11))).toEqual([]);
  });

  it("returns nothing for a hunk-header line (no new-side line number)", () => {
    const target = finding({ start_line: 10, end_line: 12 });
    expect(
      findingsCoveringLine([target], "src/a.ts", { kind: "hunk", text: "@@ -1,2 +1,3 @@" }),
    ).toEqual([]);
  });
});

describe("addedLineSet / newSideLineSet", () => {
  it("addedLineSet keeps only kind=add", () => {
    const lines: Line[] = [
      { kind: "hunk", text: "@@" },
      { kind: "add", text: "a", newNo: 1 },
      { kind: "del", text: "b", oldNo: 1 },
      { kind: "ctx", text: "c", oldNo: 2, newNo: 2 },
    ];
    expect([...addedLineSet(lines)]).toEqual([1]);
    expect([...newSideLineSet(lines)].sort((a, b) => a - b)).toEqual([1, 2]);
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
