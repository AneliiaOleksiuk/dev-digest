import { describe, it, expect } from "vitest";
import type { AgentColumn } from "@devdigest/shared";
import { columnsProgress } from "./helpers";

function column(status: AgentColumn["status"]): AgentColumn {
  return {
    run_id: `r-${status}`,
    agent_id: "a1",
    agent_name: "Agent",
    provider: "openai",
    model: "gpt-4.1",
    status,
    verdict: null,
    score: null,
    summary: null,
    duration_ms: null,
    cost_usd: null,
    findings: [],
  };
}

describe("columnsProgress", () => {
  it("counts done/failed/cancelled as settled, running as not", () => {
    const progress = columnsProgress([column("done"), column("failed"), column("cancelled"), column("running")]);
    expect(progress).toEqual({ done: 3, total: 4 });
  });

  it("all running → 0 done", () => {
    expect(columnsProgress([column("running"), column("running")])).toEqual({ done: 0, total: 2 });
  });

  it("empty batch", () => {
    expect(columnsProgress([])).toEqual({ done: 0, total: 0 });
  });
});
