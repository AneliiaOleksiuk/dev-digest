import { describe, it, expect } from "vitest";
import type { FindingGroup, FindingRecord } from "@devdigest/shared";
import { groupKey, memberFindingRecord } from "./helpers";

const GROUP: FindingGroup = {
  file: "src/api/users.ts",
  normalized_file: "src/api/users.ts",
  start_line: 45,
  end_line: 47,
  category: "bug",
  members: [
    { id: "f1", run_id: "run-1", agent_id: "a1", agent_name: "Security", severity: "WARNING", title: "N+1 query", rationale: "Loops.", suggestion: null, confidence: 0.8 },
  ],
};

describe("groupKey", () => {
  it("is stable per file+lines+category", () => {
    expect(groupKey(GROUP)).toBe("src/api/users.ts:45-47:bug");
  });
});

describe("memberFindingRecord", () => {
  it("prefers the REAL persisted finding when present in the lookup", () => {
    const real: FindingRecord = {
      id: "f1",
      severity: "WARNING",
      category: "bug",
      title: "N+1 query",
      file: "src/api/users.ts",
      start_line: 45,
      end_line: 47,
      rationale: "Loops.",
      suggestion: null,
      confidence: 0.8,
      kind: "finding",
      trifecta_components: null,
      evidence: null,
      review_id: "rev-1",
      accepted_at: "2026-01-01T00:00:00.000Z",
      dismissed_at: null,
    };
    const result = memberFindingRecord(GROUP, GROUP.members[0]!, new Map([["f1", real]]));
    expect(result).toBe(real);
    expect(result.accepted_at).not.toBeNull();
  });

  it("reconstructs a projection when the finding isn't in the lookup yet, never inventing accept/dismiss state", () => {
    const result = memberFindingRecord(GROUP, GROUP.members[0]!, new Map());
    expect(result.title).toBe("N+1 query");
    expect(result.file).toBe("src/api/users.ts");
    expect(result.accepted_at).toBeNull();
    expect(result.dismissed_at).toBeNull();
  });
});
