import { describe, it, expect } from "vitest";
import type { Conflict } from "@devdigest/shared";
import { filterConflicts, isConflict } from "./helpers";

function conflict(overrides: Partial<Conflict> = {}): Conflict {
  return {
    file: "src/api/users.ts",
    line: 45,
    title: "N+1 query",
    takes: [
      { agent_id: "a1", persona: "Security", verdict: "WARNING", note: "Flagged as a warning." },
      { agent_id: "a2", persona: "Perf", verdict: "ignored", note: "Not in this agent's focus area." },
    ],
    ...overrides,
  };
}

describe("isConflict (AC-30)", () => {
  it("a silent/ignored participant counts as a conflict on its own, even with zero severity divergence", () => {
    // Only one agent flagged it (WARNING); the other is a silent 'ignored' —
    // no severity clash possible with a single flagging agent, but AC-30's
    // OR-clause still makes this a genuine conflict.
    expect(isConflict(conflict())).toBe(true);
  });

  it("true when the agents that DID flag it disagree on severity (no silence involved)", () => {
    const c = conflict({
      takes: [
        { agent_id: "a1", persona: "Security", verdict: "CRITICAL", note: "" },
        { agent_id: "a2", persona: "Perf", verdict: "SUGGESTION", note: "" },
      ],
    });
    expect(isConflict(c)).toBe(true);
  });

  it("false — genuinely all agree: every agent flagged it, no silence, same severity", () => {
    const c = conflict({
      takes: [
        { agent_id: "a1", persona: "Security", verdict: "WARNING", note: "" },
        { agent_id: "a2", persona: "Perf", verdict: "WARNING", note: "" },
      ],
    });
    expect(isConflict(c)).toBe(false);
  });
});

describe("filterConflicts", () => {
  it("OFF (default) returns every row the server sent, unchanged — including a genuinely-all-agree row", () => {
    const allAgree = conflict({
      takes: [
        { agent_id: "a1", persona: "Security", verdict: "WARNING", note: "" },
        { agent_id: "a2", persona: "Perf", verdict: "WARNING", note: "" },
      ],
    });
    expect(filterConflicts([allAgree], false)).toEqual([allAgree]);
  });

  it("ON includes a silent-participant-only row (it didn't before this fix)", () => {
    const silentOnly = conflict(); // one WARNING + one ignored, same as default fixture
    expect(filterConflicts([silentOnly], true)).toEqual([silentOnly]);
  });

  it("ON excludes a genuinely-all-agree row (no silence, no severity divergence) but shows it OFF", () => {
    const allAgree = conflict({
      takes: [
        { agent_id: "a1", persona: "Security", verdict: "WARNING", note: "" },
        { agent_id: "a2", persona: "Perf", verdict: "WARNING", note: "" },
      ],
    });
    expect(filterConflicts([allAgree], true)).toEqual([]);
    expect(filterConflicts([allAgree], false)).toEqual([allAgree]);
  });

  it("ON still narrows to true severity clashes among non-ignored takes", () => {
    const divergent = conflict({
      takes: [
        { agent_id: "a1", persona: "Security", verdict: "CRITICAL", note: "" },
        { agent_id: "a2", persona: "Perf", verdict: "SUGGESTION", note: "" },
      ],
    });
    const allAgree = conflict({
      takes: [
        { agent_id: "a1", persona: "Security", verdict: "WARNING", note: "" },
        { agent_id: "a2", persona: "Perf", verdict: "WARNING", note: "" },
      ],
    });
    expect(filterConflicts([allAgree, divergent], true)).toEqual([divergent]);
  });
});
