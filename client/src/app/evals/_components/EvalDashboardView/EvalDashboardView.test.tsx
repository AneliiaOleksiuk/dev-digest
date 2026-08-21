/**
 * EvalDashboardView — the workspace-wide Eval Dashboard (L06 WI13).
 *
 * Oracle (derived from docs/plans/eval-pipeline.md WI13 and
 * specs/eval-pipeline.md AC-36/AC-37/AC-47/UX-9/E-15 BEFORE reading
 * EvalDashboardView.tsx):
 *   - E-15: "eval_cases.owner_id is a plain uuid with no foreign key to
 *     agents ... The case list must handle an owner that no longer
 *     exists." Applied here to the dashboard's per-agent row list, which is
 *     the one surface in this feature that lists owners across the whole
 *     workspace (the Evals tab itself is scoped to a live `agent` prop and
 *     cannot be reached for a deleted agent).
 *   - AC-47/UX-9: "the run-all-agents action shall state the multiplied
 *     figure" before the click.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalDashboard } from "@/lib/types";
import evalMessages from "../../../../../messages/en/eval.json";

const useEvalDashboard = vi.fn();
const useRunEvalSet = vi.fn();
const useAgents = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/evals",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/lib/hooks/eval", () => ({
  useEvalDashboard: (...args: unknown[]) => useEvalDashboard(...args),
  useRunEvalSet: (...args: unknown[]) => useRunEvalSet(...args),
  useAgentEvalBatches: () => ({ data: [] }),
  useAgentEvalDashboard: () => ({ data: undefined }),
}));
vi.mock("@/lib/hooks/agents", () => ({
  useAgents: (...args: unknown[]) => useAgents(...args),
}));

import { EvalDashboardView } from "./EvalDashboardView";

afterEach(() => {
  cleanup();
  useEvalDashboard.mockReset();
  useRunEvalSet.mockReset();
  useAgents.mockReset();
});

function renderDashboard() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <EvalDashboardView />
    </NextIntlClientProvider>,
  );
}

const LIVE_ROW: EvalDashboard = {
  owner_kind: "agent",
  owner_id: "ag1",
  cases_total: 8,
  current: { recall: 0.9, precision: 0.9, citation_accuracy: 0.95, traces_passed: 7, traces_total: 8, cost_usd: 0.02 },
  delta: null,
  trend: [{ batch_id: "b0", agent_version: 5, ran_at: "2026-08-10T00:00:00.000Z", recall: 0.9, precision: 0.9, citation_accuracy: 0.95, pass_rate: 0.875, cost_usd: 0.02 }],
  recent_runs: [],
  alert: null,
};

const ORPHANED_ROW: EvalDashboard = {
  owner_kind: "agent",
  owner_id: "ag-deleted",
  cases_total: 2,
  current: { recall: null, precision: null, citation_accuracy: null, traces_passed: 0, traces_total: 0, cost_usd: null },
  delta: null,
  trend: [],
  recent_runs: [],
  alert: null,
};

describe("EvalDashboardView — E-15 an owner that no longer resolves to a live agent still renders, not crashes", () => {
  it("renders a row for the deleted agent labeled distinctly, alongside the live agent's own name", () => {
    useEvalDashboard.mockReturnValue({ data: [LIVE_ROW, ORPHANED_ROW], isLoading: false, isError: false, refetch: vi.fn() });
    useAgents.mockReturnValue({ data: [{ id: "ag1", name: "Security Reviewer" }] });
    useRunEvalSet.mockReturnValue({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });

    renderDashboard();

    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("ag-delet… (deleted agent)")).toBeInTheDocument();
  });
});

describe("EvalDashboardView — AC-47/UX-9 the run-all-agents estimate states the multiplied figure before the click", () => {
  it("shows the calls × agents × cost estimate next to 'Run all agents'", () => {
    useEvalDashboard.mockReturnValue({ data: [LIVE_ROW], isLoading: false, isError: false, refetch: vi.fn() });
    useAgents.mockReturnValue({ data: [{ id: "ag1", name: "Security Reviewer" }] });
    useRunEvalSet.mockReturnValue({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });

    renderDashboard();

    expect(screen.getByText("Run all agents (1)")).toBeInTheDocument();
    expect(screen.getByText(/≈8 model call\(s\) across 1 agent\(s\)/)).toBeInTheDocument();
  });
});
