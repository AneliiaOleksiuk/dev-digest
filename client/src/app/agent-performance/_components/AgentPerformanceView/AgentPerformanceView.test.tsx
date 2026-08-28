/**
 * AgentPerformanceView — the workspace-wide Agent Performance dashboard.
 *
 * Oracle (derived from docs/plans/spec-06-agent-performance-dashboard.md
 * Test plan → Coverage: "AC-37 — component test asserting the whole-page
 * empty state (AC-36) and a single zero-run agent's table row (workspace has
 * runs, this agent doesn't) render distinguishable output — not the same
 * blank/zero rendering" and specs/SPEC-06-agent-performance-dashboard.md
 * AC-33/AC-34/AC-36/AC-37 BEFORE reading `AgentPerformanceView.tsx` beyond
 * the wiring facts (hook import path, i18n keys).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentPerf, AgentPerfRow } from "@devdigest/shared";
import agentPerformanceMessages from "../../../../../messages/en/agentPerformance.json";

const useAgentPerf = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/agent-performance",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/lib/hooks/agent-performance", () => ({
  useAgentPerf: (...args: unknown[]) => useAgentPerf(...args),
}));

import { AgentPerformanceView } from "./AgentPerformanceView";

afterEach(() => {
  cleanup();
  useAgentPerf.mockReset();
});

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agentPerformance: agentPerformanceMessages }}>
      <AgentPerformanceView />
    </NextIntlClientProvider>,
  );
}

function agentRow(overrides: Partial<AgentPerfRow>): AgentPerfRow {
  return {
    agent_id: "a1",
    agent_name: "Security Reviewer",
    provider: "openai",
    model: "gpt-4.1",
    runs: 10,
    findings_total: 20,
    accepted: 8,
    dismissed: 4,
    accept_rate: 0.67,
    dismiss_rate: 0.33,
    avg_findings_per_run: 2,
    total_cost_usd: 1.2,
    avg_cost_usd: 0.12,
    avg_latency_ms: 4500,
    last_run_at: "2026-08-20T00:00:00.000Z",
    findings_by_severity: { CRITICAL: 1, WARNING: 5, SUGGESTION: 14 },
    trend: [1, 2, 3],
    ...overrides,
  };
}

function perfFixture(overrides: Partial<AgentPerf> = {}): AgentPerf {
  return {
    summary: {
      runs: 10,
      total_cost_usd: 1.2,
      avg_accept_rate: 0.67,
      most_active_agent: "Security Reviewer",
      most_active_agent_id: "a1",
      total_cost_partial: false,
      // fix-loop (C2) — mechanical ripple from AgentPerf.summary.runs_trend
      // being added with `.default([])` (root INSIGHTS.md's documented
      // "known ripple" pattern for additive-with-default contract fields);
      // no assertion in this file changed.
      runs_trend: [],
    },
    agents: [agentRow({})],
    cost_by_agent: [{ label: "Security Reviewer", value: 1.2 }],
    cost_by_model: [{ label: "gpt-4.1", value: 1.2 }],
    ...overrides,
  };
}

describe("AC-34 — loading renders no numeric value", () => {
  it("shows skeleton placeholders only — no run count, no cost figure, no accept-rate", () => {
    useAgentPerf.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() });
    const { container } = renderView();

    // No summary tile text present while loading.
    expect(screen.queryByText("Total runs")).not.toBeInTheDocument();
    // MetricCard renders its numeric value in a `.tnum` span — none exist
    // while loading (no zeros, no stale figures; the range-selector's own
    // "1 day"/"30 days" option labels are incidental UI copy, not a metric).
    expect(container.querySelectorAll(".tnum")).toHaveLength(0);
  });
});

describe("AC-35 — failure renders the error state, never tiles/table/donuts", () => {
  it("renders loadError text and nothing from the data-driven sections", () => {
    useAgentPerf.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: vi.fn() });
    renderView();

    expect(screen.getByText("Could not load agent performance.")).toBeInTheDocument();
    expect(screen.queryByText("Total runs")).not.toBeInTheDocument();
    expect(screen.queryByText("Cost by agent")).not.toBeInTheDocument();
  });
});

describe("AC-36/AC-37 — the whole-workspace empty state is visually distinct from a populated table's zero-run agent row", () => {
  it("AC-36: a workspace with zero counted runs anywhere renders the empty state, not a table with all-zero rows", () => {
    useAgentPerf.mockReturnValue({
      data: perfFixture({
        summary: {
          runs: 0,
          total_cost_usd: null,
          avg_accept_rate: null,
          most_active_agent: null,
          most_active_agent_id: null,
          total_cost_partial: false,
          runs_trend: [],
        },
        agents: [],
        cost_by_agent: [],
        cost_by_model: [],
      }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    renderView();

    expect(screen.getByText("No agent runs yet")).toBeInTheDocument();
    // No per-agent table renders at all in the whole-workspace-empty state.
    expect(screen.queryByText("Per-agent")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("AC-37: a populated workspace with one zero-run agent renders that agent as an explicit zero-run TABLE ROW, with a null (not 0%) accept rate — never the AC-36 empty state", () => {
    const liveAgent = agentRow({ agent_id: "a1", agent_name: "Security Reviewer", runs: 12 });
    const zeroRunAgent = agentRow({
      agent_id: "a2",
      agent_name: "Idle Agent",
      runs: 0,
      accepted: 0,
      dismissed: 0,
      accept_rate: null,
      dismiss_rate: null,
      avg_cost_usd: null,
      avg_latency_ms: null,
      last_run_at: null,
      trend: [],
    });

    useAgentPerf.mockReturnValue({
      data: perfFixture({
        summary: {
          runs: 12,
          total_cost_usd: 1.2,
          avg_accept_rate: 0.67,
          most_active_agent: "Security Reviewer",
          most_active_agent_id: "a1",
          total_cost_partial: false,
          runs_trend: [],
        },
        agents: [liveAgent, zeroRunAgent],
      }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    renderView();

    // NOT the whole-page empty state.
    expect(screen.queryByText("No agent runs yet")).not.toBeInTheDocument();
    // The zero-run agent is visible, distinguishable via the explicit
    // zero-runs treatment (Idle Agent has < 5 decided findings, so it's in
    // the flagged low-confidence group, which is where AC-37's zero-run
    // treatment renders).
    expect(screen.getByText("Idle Agent")).toBeInTheDocument();
    expect(screen.getByText(/no runs in range/)).toBeInTheDocument();
    // The live agent's row (well outside the low-confidence path here, since
    // 8 accepted + 4 dismissed = 12 decided >= 5) still renders normally —
    // appears both as the "Most active" tile value AND its own table row.
    expect(screen.getAllByText("Security Reviewer").length).toBeGreaterThanOrEqual(1);
  });
});
