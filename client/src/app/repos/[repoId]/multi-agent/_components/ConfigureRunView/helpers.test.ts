import { describe, it, expect } from "vitest";
import type { AgentCostEstimate } from "@/lib/hooks/multi-agent";
import { agentEstimateFor, computeSelectionEstimate, defaultSelectedAgentIds } from "./helpers";

function stats(overrides: Partial<AgentCostEstimate> = {}): AgentCostEstimate {
  return {
    agent_id: "a1",
    agent_name: "Security",
    avg_duration_ms: 8200,
    avg_cost_usd: 0.06,
    sample_size: 12,
    ...overrides,
  };
}

describe("computeSelectionEstimate", () => {
  it("sums cost but takes the MAX duration (a parallel batch's wall-clock, not the sum)", () => {
    const est = computeSelectionEstimate(
      [stats({ agent_id: "a1", avg_cost_usd: 0.06, avg_duration_ms: 8200 }), stats({ agent_id: "a2", avg_cost_usd: 0.02, avg_duration_ms: 15000 })],
      ["a1", "a2"],
    );
    expect(est.totalCostUsd).toBeCloseTo(0.08);
    expect(est.maxDurationMs).toBe(15000);
    expect(est.costPartial).toBe(false);
    expect(est.hasAnyEstimate).toBe(true);
  });

  it("an agent with no stats row contributes nothing, not $0/0ms", () => {
    const est = computeSelectionEstimate([stats({ agent_id: "a1", avg_cost_usd: 0.06, avg_duration_ms: 8200 })], ["a1", "a2"]);
    expect(est.totalCostUsd).toBeCloseTo(0.06);
    expect(est.maxDurationMs).toBe(8200);
    expect(est.costPartial).toBe(true); // one of two selected agents contributed cost
  });

  it("no selected agent has any stats → hasAnyEstimate is false, nulls not zeros", () => {
    const est = computeSelectionEstimate([], ["a1", "a2"]);
    expect(est.totalCostUsd).toBeNull();
    expect(est.maxDurationMs).toBeNull();
    expect(est.hasAnyEstimate).toBe(false);
    expect(est.costPartial).toBe(false);
  });

  it("empty selection → no estimate, no partial badge", () => {
    const est = computeSelectionEstimate([stats()], []);
    expect(est.hasAnyEstimate).toBe(false);
    expect(est.costPartial).toBe(false);
  });
});

describe("agentEstimateFor", () => {
  it("returns null for an agent with zero runs (never run under its current model)", () => {
    expect(agentEstimateFor(stats({ sample_size: 0, avg_cost_usd: null, avg_duration_ms: null }))).toBeNull();
  });

  it("returns null when stats are missing entirely", () => {
    expect(agentEstimateFor(undefined)).toBeNull();
    expect(agentEstimateFor(null)).toBeNull();
  });

  it("converts ms to seconds and passes through cost + sample size", () => {
    const est = agentEstimateFor(stats({ avg_duration_ms: 8200, avg_cost_usd: 0.06, sample_size: 12 }));
    expect(est).toEqual({ durationS: 8.2, costUsd: 0.06, sampleRuns: 12 });
  });
});

describe("defaultSelectedAgentIds", () => {
  it("selects only enabled agents by default", () => {
    const ids = defaultSelectedAgentIds([
      { id: "a1", enabled: true },
      { id: "a2", enabled: false },
      { id: "a3", enabled: true },
    ]);
    expect(ids).toEqual(["a1", "a3"]);
  });
});
