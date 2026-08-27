/**
 * StatsTab — the per-agent Stats tab (Agent Editor).
 *
 * Oracle (derived from docs/plans/spec-06-agent-performance-dashboard.md WI9
 * and specs/SPEC-06-agent-performance-dashboard.md AC-12/AC-14/AC-26/AC-33/
 * AC-34, US-5 BEFORE reading `StatsTab.tsx` beyond wiring facts): loading
 * renders no numeric value (AC-34), a zero-decided accept rate renders as
 * "—" not "0%" (AC-12/E-10), the accept-rate denominator is visible (US-5),
 * cost is labeled an estimate (AC-26), and the live-snapshot caveat is shown
 * (E-6/AC-14).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, AgentStats } from "@devdigest/shared";
import agentsMessages from "../../../../../../../../messages/en/agents.json";

const useAgentDetailStats = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/agents/ag1",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/hooks/agents", () => ({
  useAgentDetailStats: (...args: unknown[]) => useAgentDetailStats(...args),
}));

import { StatsTab } from "./StatsTab";

afterEach(() => {
  cleanup();
  useAgentDetailStats.mockReset();
});

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "p",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: agentsMessages }}>
      <StatsTab agent={AGENT} />
    </NextIntlClientProvider>,
  );
}

function statsFixture(overrides: Partial<AgentStats> = {}): AgentStats {
  return {
    agent_id: "ag1",
    agent_name: "Security Reviewer",
    runs: 10,
    findings_total: 20,
    accepted: 8,
    dismissed: 4,
    pending: 8,
    accept_rate: 0.67,
    dismiss_rate: 0.33,
    avg_findings_per_run: 2,
    total_cost_usd: 1.2,
    avg_cost_usd: 0.12,
    avg_latency_ms: 4500,
    findings_by_severity: { CRITICAL: 1, WARNING: 5, SUGGESTION: 14 },
    // The real endpoint always buckets `trend` into BUCKET_COUNT (12) points
    // (`modules/agents/performance.ts`) — a faithful fixture uses more than
    // one point so Sparkline's `i / (data.length - 1)` never divides by zero.
    trend: Array.from({ length: 12 }, (_, i) => ({ label: `2026-08-${String(i + 1).padStart(2, "0")}`, value: i })),
    ...overrides,
  };
}

describe("AC-34 — loading renders no numeric value", () => {
  it("shows skeletons only — no runs/cost/latency/accept-rate figures", () => {
    useAgentDetailStats.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() });
    const { container } = renderTab();

    expect(screen.queryByText("Runs")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".tnum")).toHaveLength(0);
  });
});

describe("AC-35/NFR-7 — a failed load renders the error state, not a confident zero", () => {
  it("renders loadError and no metric tiles", () => {
    useAgentDetailStats.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: vi.fn() });
    renderTab();

    expect(screen.getByText("Could not load this agent's stats.")).toBeInTheDocument();
    expect(screen.queryByText("Runs")).not.toBeInTheDocument();
  });
});

describe("AC-12/E-10 — an agent with runs but zero decided findings shows a null accept rate, never 0%", () => {
  it("renders '—' for accept rate, not '0%', and still shows the 0-of-N denominator (US-5)", () => {
    useAgentDetailStats.mockReturnValue({
      data: statsFixture({ accepted: 0, dismissed: 0, pending: 20, accept_rate: null, dismiss_rate: null }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderTab();

    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("0 of 0 decided")).toBeInTheDocument();
  });
});

describe("US-5 — the accept-rate denominator is visible next to the headline percentage", () => {
  it("shows '8 of 12 decided' alongside 67%", () => {
    useAgentDetailStats.mockReturnValue({ data: statsFixture({}), isLoading: false, isError: false, refetch: vi.fn() });
    renderTab();

    expect(screen.getByText("67%")).toBeInTheDocument();
    expect(screen.getByText("8 of 12 decided")).toBeInTheDocument();
  });
});

describe("AC-26/G-5 — cost is labeled an estimate, never billed/actual", () => {
  it("shows the cost-is-an-estimate note", () => {
    useAgentDetailStats.mockReturnValue({ data: statsFixture({}), isLoading: false, isError: false, refetch: vi.fn() });
    renderTab();

    expect(screen.getByText("Cost is an estimate from model pricing, not a billed amount.")).toBeInTheDocument();
  });
});

describe("Empty range — zero runs renders the empty state, not zeroed tiles", () => {
  it("renders the empty-range copy when stats.runs === 0", () => {
    useAgentDetailStats.mockReturnValue({
      data: statsFixture({ runs: 0, findings_total: 0, accepted: 0, dismissed: 0, pending: 0, accept_rate: null }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderTab();

    expect(screen.getByText("No runs in this range")).toBeInTheDocument();
    expect(screen.queryByText("Accept rate")).not.toBeInTheDocument();
  });
});
