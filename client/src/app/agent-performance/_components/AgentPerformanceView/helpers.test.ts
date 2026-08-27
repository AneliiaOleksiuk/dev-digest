import { describe, it, expect } from "vitest";
import type { AgentPerfRow } from "@devdigest/shared";
import { isLowConfidence, rankByAcceptRate } from "./helpers";

/**
 * AC-31/AC-32 — the ranking rule as a pure exported comparator.
 *
 * Oracle derived from docs/plans/spec-06-agent-performance-dashboard.md
 * (Test plan → Coverage: "AC-31 — unit test on the sort comparator with a
 * 1-decision, 100%-accept agent, asserting it lands in the flagged
 * low-confidence group and not at the top of the ranking; plus AC-32's
 * all-below-threshold case") and specs/SPEC-06-agent-performance-dashboard.md
 * AC-31/AC-32/D-15 (fewer than 5 decided findings = low-confidence, excluded
 * from ranking) BEFORE reading `helpers.ts`'s actual `LOW_CONFIDENCE_THRESHOLD`
 * value beyond confirming it matches D-15's "5".
 */

function row(overrides: Partial<AgentPerfRow>): AgentPerfRow {
  return {
    agent_id: "a1",
    agent_name: "Agent",
    provider: "openai",
    model: "gpt-4.1",
    runs: 0,
    findings_total: 0,
    accepted: 0,
    dismissed: 0,
    accept_rate: null,
    dismiss_rate: null,
    avg_findings_per_run: null,
    total_cost_usd: null,
    avg_cost_usd: null,
    avg_latency_ms: null,
    last_run_at: null,
    findings_by_severity: { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 },
    trend: [],
    ...overrides,
  };
}

describe("AC-31 — an agent with fewer than 5 decided findings is low-confidence and excluded from the ranked group", () => {
  it("a 1-decision, 100%-accept agent lands in `lowConfidence`, NOT at the top of `ranked`", () => {
    const oneDecision = row({ agent_id: "flash-in-the-pan", runs: 1, accepted: 1, dismissed: 0, accept_rate: 1 });
    const wellSampled = row({ agent_id: "steady", runs: 50, accepted: 30, dismissed: 20, accept_rate: 0.6 });

    const { ranked, lowConfidence, allLowConfidence } = rankByAcceptRate([oneDecision, wellSampled]);

    expect(ranked.map((r) => r.agent_id)).toEqual(["steady"]);
    expect(lowConfidence.map((r) => r.agent_id)).toEqual(["flash-in-the-pan"]);
    expect(allLowConfidence).toBe(false);
    // The 100%-accept agent must not be first (or anywhere) in `ranked`.
    expect(ranked[0]?.agent_id).not.toBe("flash-in-the-pan");
  });

  it("isLowConfidence: exactly 5 decided findings is the threshold — 4 is low-confidence, 5 is not", () => {
    expect(isLowConfidence(row({ accepted: 2, dismissed: 2 }))).toBe(true); // 4 decided
    expect(isLowConfidence(row({ accepted: 3, dismissed: 2 }))).toBe(false); // 5 decided
  });
});

describe("AC-32 — when every agent is below the threshold, the sort stays operable and communicates no rankable sample", () => {
  it("`ranked` is empty, `lowConfidence` holds every row, and `allLowConfidence` is true (not a crash/arbitrary order)", () => {
    const a = row({ agent_id: "a", runs: 2, accepted: 1, dismissed: 0, accept_rate: 1 });
    const b = row({ agent_id: "b", runs: 1, accepted: 0, dismissed: 1, accept_rate: 0 });

    const { ranked, lowConfidence, allLowConfidence } = rankByAcceptRate([a, b]);

    expect(ranked).toHaveLength(0);
    expect(lowConfidence).toHaveLength(2);
    expect(allLowConfidence).toBe(true);
  });

  it("an EMPTY workspace (no agents at all) does not spuriously report allLowConfidence", () => {
    // Distinguishes "no agent has a rankable sample" from "there are no
    // agents to rank at all" — the empty-workspace case is AC-36's whole-page
    // empty state, not AC-32's not-rankable message.
    const { ranked, lowConfidence, allLowConfidence } = rankByAcceptRate([]);
    expect(ranked).toHaveLength(0);
    expect(lowConfidence).toHaveLength(0);
    expect(allLowConfidence).toBe(false);
  });
});
