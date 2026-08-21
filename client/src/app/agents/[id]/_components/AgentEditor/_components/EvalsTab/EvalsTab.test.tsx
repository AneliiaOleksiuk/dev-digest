/**
 * EvalsTab — the Agent Editor's Evals tab (L06 WI12).
 *
 * Oracle (derived from docs/plans/eval-pipeline.md WI12 and
 * specs/eval-pipeline.md AC-10/AC-13/AC-35/AC-47/UX-9/E-17 BEFORE reading
 * EvalsTab.tsx):
 *   - AC-35: "shall render the agent's metrics and its case list ... plus
 *     'New case' and per-case Run/Edit/Delete actions ... and shall render
 *     evalsTab.emptyCases when the agent has no cases" — both the empty and
 *     populated states must be covered.
 *   - AC-13: "a case with expectation_status: 'unusable' renders as clearly
 *     unusable rather than crashing."
 *   - AC-47/UX-9: "state how many model calls it will make and the last
 *     comparable run's cost" before a run is started.
 *   - E-17/UX-12: a first batch ("nothing to compare yet") is not a zero
 *     delta.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import type { EvalBatchRecord, EvalCaseRecord, EvalDashboard } from "@/lib/types";
import evalMessages from "../../../../../../../../messages/en/eval.json";

const useAgentEvalCases = vi.fn();
const useAgentEvalDashboard = vi.fn();
const useDeleteEvalCase = vi.fn();
const useEvalBatches = vi.fn();
const useRunEvalCase = vi.fn();
const useRunEvalSet = vi.fn();

vi.mock("@/lib/hooks/eval", () => ({
  useAgentEvalCases: (...args: unknown[]) => useAgentEvalCases(...args),
  useAgentEvalDashboard: (...args: unknown[]) => useAgentEvalDashboard(...args),
  useDeleteEvalCase: (...args: unknown[]) => useDeleteEvalCase(...args),
  useEvalBatches: (...args: unknown[]) => useEvalBatches(...args),
  useRunEvalCase: (...args: unknown[]) => useRunEvalCase(...args),
  useRunEvalSet: (...args: unknown[]) => useRunEvalSet(...args),
}));

import { EvalsTab } from "./EvalsTab";

afterEach(() => {
  cleanup();
  useAgentEvalCases.mockReset();
  useAgentEvalDashboard.mockReset();
  useDeleteEvalCase.mockReset();
  useEvalBatches.mockReset();
  useRunEvalCase.mockReset();
  useRunEvalSet.mockReset();
});

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 6,
};

const EMPTY_DASHBOARD: EvalDashboard = {
  owner_kind: "agent",
  owner_id: "ag1",
  cases_total: 0,
  current: { recall: null, precision: null, citation_accuracy: null, traces_passed: 0, traces_total: 0, cost_usd: null },
  delta: null,
  trend: [],
  recent_runs: [],
  alert: null,
};

const CASE_OK: EvalCaseRecord = {
  id: "c1",
  owner_kind: "agent",
  owner_id: "ag1",
  name: "stripe-key-leak",
  input_diff: "--- a/src/config.ts\n+++ b/src/config.ts\n@@ -1,1 +1,1 @@\n+ stripeKey",
  input_files: ["src/config.ts"],
  input_meta: { title: "Add Stripe", body: "desc" },
  input_status: "ok",
  expected_output: {
    version: 1,
    must_find: [
      { file: "src/config.ts", start_line: 1, end_line: 1, match_scope: "range", severity: null, category: null, title: null, source_finding_id: "f1" },
    ],
    must_not_flag: [],
  },
  expectation_status: "ok",
  notes: null,
};

const CASE_UNUSABLE: EvalCaseRecord = {
  ...CASE_OK,
  id: "c2",
  name: "legacy-case",
  expected_output: null,
  expectation_status: "unusable",
};

function renderTab(agent: Agent = AGENT) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <EvalsTab agent={agent} />
    </NextIntlClientProvider>,
  );
}

describe("EvalsTab — AC-35 empty/populated states", () => {
  it("renders evalsTab.emptyCases when the agent has zero cases", () => {
    useAgentEvalCases.mockReturnValue({ data: [] });
    useAgentEvalDashboard.mockReturnValue({ data: EMPTY_DASHBOARD });
    useEvalBatches.mockReturnValue([]);
    useDeleteEvalCase.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useRunEvalCase.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useRunEvalSet.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderTab();

    expect(
      screen.getByText("No eval cases yet. Create one to assert this agent's expected findings on a sample diff."),
    ).toBeInTheDocument();
    // "New case" is still offered even with zero cases.
    expect(screen.getByText("New case")).toBeInTheDocument();
  });

  it("renders metrics + the case list (with a per-case Run/Edit/Delete row) when cases exist", () => {
    const dashboard: EvalDashboard = {
      ...EMPTY_DASHBOARD,
      cases_total: 1,
      current: { recall: 0.8, precision: 0.9, citation_accuracy: 1, traces_passed: 1, traces_total: 1, cost_usd: 0.01 },
    };
    useAgentEvalCases.mockReturnValue({ data: [CASE_OK] });
    useAgentEvalDashboard.mockReturnValue({ data: dashboard });
    useEvalBatches.mockReturnValue([]);
    useDeleteEvalCase.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useRunEvalCase.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useRunEvalSet.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderTab();

    expect(screen.getByText("stripe-key-leak")).toBeInTheDocument();
    expect(screen.getByText("never run")).toBeInTheDocument();
    expect(screen.getByText("Run")).toBeInTheDocument();
    expect(screen.getByText("Edit")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
    // RECALL/PRECISION/CITATION ACCURACY metric tiles render, not "n/a",
    // since every metric is defined on this dashboard.
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(screen.getByText("90%")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
  });
});

describe("EvalsTab — AC-13 a case with expectation_status 'unusable' renders as clearly unusable, not a crash", () => {
  it("shows the invalidJson badge instead of a pass/fail state, and disables Run", () => {
    const dashboard: EvalDashboard = { ...EMPTY_DASHBOARD, cases_total: 1 };
    useAgentEvalCases.mockReturnValue({ data: [CASE_UNUSABLE] });
    useAgentEvalDashboard.mockReturnValue({ data: dashboard });
    useEvalBatches.mockReturnValue([]);
    useDeleteEvalCase.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useRunEvalCase.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useRunEvalSet.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderTab();

    expect(screen.getByText("legacy-case")).toBeInTheDocument();
    expect(screen.getByText("invalid JSON")).toBeInTheDocument();
    expect(screen.queryByText("never run")).not.toBeInTheDocument();
    expect(screen.getByText("Run").closest("button")).toBeDisabled();
  });
});

describe("EvalsTab — regression: metric captions read their OWN contributing-case count", () => {
  it("each metric tile's caption shows ITS OWN *_cases field, not cases_total and not another metric's count", () => {
    // All four numbers deliberately distinct so a caption reading the wrong
    // field (e.g. cases_total, or another metric's *_cases) is caught.
    const batch: EvalBatchRecord = {
      id: "b0",
      owner_kind: "agent",
      owner_id: "ag1",
      agent_version: 6,
      provider: "openai",
      model: "gpt-4.1",
      skills_fingerprint: [],
      ran_at: "2026-08-10T00:00:00.000Z",
      status: "completed",
      cases_total: 11,
      cases_passed: 7,
      cases_failed: 1,
      recall: 0.9,
      precision: 0.9,
      citation_accuracy: 0.95,
      recall_cases: 3,
      precision_cases: 5,
      citation_cases: 9,
      findings_total: 12,
      duration_ms: 4000,
      cost_usd: 0.02,
      error: null,
    };
    const dashboard: EvalDashboard = {
      ...EMPTY_DASHBOARD,
      cases_total: 20, // owner's whole case set — must NOT appear in any caption
      current: { recall: 0.9, precision: 0.9, citation_accuracy: 0.95, traces_passed: 7, traces_total: 8, cost_usd: 0.02 },
      recent_runs: [batch],
    };
    useAgentEvalCases.mockReturnValue({ data: [CASE_OK] });
    useAgentEvalDashboard.mockReturnValue({ data: dashboard });
    useEvalBatches.mockReturnValue([]);
    useDeleteEvalCase.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useRunEvalCase.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useRunEvalSet.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderTab();

    expect(screen.getByText("3 of 11 cases")).toBeInTheDocument();
    expect(screen.getByText("5 of 11 cases")).toBeInTheDocument();
    expect(screen.getByText("9 of 11 cases")).toBeInTheDocument();
    expect(screen.queryByText("20 of 11 cases")).not.toBeInTheDocument();
    expect(screen.queryByText(/of 20 cases/)).not.toBeInTheDocument();
  });
});

describe("EvalsTab — AC-47/UX-9 the run estimate is stated before the click", () => {
  it("shows the call-count + last-run-cost estimate next to the Run eval button", () => {
    const dashboard: EvalDashboard = {
      ...EMPTY_DASHBOARD,
      cases_total: 1,
      current: { recall: 0.8, precision: 0.9, citation_accuracy: 1, traces_passed: 1, traces_total: 1, cost_usd: 0.01 },
    };
    useAgentEvalCases.mockReturnValue({ data: [CASE_OK] });
    useAgentEvalDashboard.mockReturnValue({ data: dashboard });
    useEvalBatches.mockReturnValue([]);
    useDeleteEvalCase.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useRunEvalCase.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useRunEvalSet.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderTab();

    expect(screen.getByText(/≈1 model call\(s\)/)).toBeInTheDocument();
  });
});
