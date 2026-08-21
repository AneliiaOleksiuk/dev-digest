/**
 * AgentEvalDetail — per-agent eval detail (L06 WI13).
 *
 * Oracle (derived from docs/plans/eval-pipeline.md WI13 and
 * specs/eval-pipeline.md AC-37/AC-39/E-7/E-11/E-17/UX-4/UX-12 BEFORE reading
 * AgentEvalDetail.tsx):
 *   - AC-39/E-7 (SAFETY-CRITICAL): "LineChart must be passed an explicit
 *     yMin={0} yMax={1}. Its defaults are yMin=0.6, yMax=1.0 ... which
 *     clips anything below 0.6 — precisely the region the homework's own
 *     validation experiment (WI16) is designed to produce." Asserted
 *     directly against the props LineChart actually receives, not against
 *     rendered pixels — the vendored component's default domain would
 *     silently clip a deliberately-weakened prompt's precision drop off the
 *     chart, defeating the entire point of the WI16 experiment.
 *   - UX-4/E-11: an undefined metric renders as an explicit "n/a", never a
 *     flattering 1.00/100%.
 *   - E-17/UX-12: a first batch (delta === null, <=1 trend point) shows
 *     "first run" messaging, not a delta of zero.
 *   - AC-37: the recent-runs table has exactly the columns
 *     dashboard.table.* names — ran-at, recall, precision, citation, pass,
 *     cost.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalBatchRecord, EvalDashboard } from "@/lib/types";
import evalMessages from "../../../../../messages/en/eval.json";

const useAgent = vi.fn();
const useAgentEvalBatches = vi.fn();
const useAgentEvalDashboard = vi.fn();
const useRunEvalSet = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/evals",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/lib/hooks/agents", () => ({
  useAgent: (...args: unknown[]) => useAgent(...args),
}));
vi.mock("@/lib/hooks/eval", () => ({
  useAgentEvalBatches: (...args: unknown[]) => useAgentEvalBatches(...args),
  useAgentEvalDashboard: (...args: unknown[]) => useAgentEvalDashboard(...args),
  useRunEvalSet: (...args: unknown[]) => useRunEvalSet(...args),
}));

// Capture exactly what LineChart is called with, without re-implementing
// the barrel — every other `@devdigest/ui` export renders for real.
let capturedLineChartProps: { yMin?: number; yMax?: number; series?: unknown[] } | null = null;
vi.mock("@devdigest/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@devdigest/ui")>();
  return {
    ...actual,
    LineChart: (props: { yMin?: number; yMax?: number; series?: unknown[] }) => {
      capturedLineChartProps = props;
      return <div data-testid="line-chart-stub" />;
    },
  };
});

import { AgentEvalDetail } from "./AgentEvalDetail";

afterEach(() => {
  cleanup();
  capturedLineChartProps = null;
  useAgent.mockReset();
  useAgentEvalBatches.mockReset();
  useAgentEvalDashboard.mockReset();
  useRunEvalSet.mockReset();
});

const AGENT = { id: "ag1", name: "Security Reviewer" };

const BATCH_V5: EvalBatchRecord = {
  id: "b0",
  owner_kind: "agent",
  owner_id: "ag1",
  agent_version: 5,
  provider: "openai",
  model: "gpt-4.1",
  skills_fingerprint: [],
  ran_at: "2026-08-10T00:00:00.000Z",
  status: "completed",
  cases_total: 8,
  cases_passed: 7,
  cases_failed: 1,
  recall: 0.9,
  precision: 0.9,
  citation_accuracy: 0.95,
  recall_cases: 8,
  precision_cases: 8,
  citation_cases: 8,
  findings_total: 12,
  duration_ms: 4000,
  cost_usd: 0.02,
  error: null,
};

// The WI16 validation-experiment shape: a deliberately-weakened prompt drops
// precision to 0.3 — exactly the point AC-39's [0,1] domain must keep visible.
const BATCH_V6_WEAKENED: EvalBatchRecord = {
  ...BATCH_V5,
  id: "b1",
  agent_version: 6,
  ran_at: "2026-08-20T00:00:00.000Z",
  cases_passed: 2,
  cases_failed: 6,
  recall: 0.9,
  precision: 0.3,
  citation_accuracy: 0.9,
};

function renderDetail() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <AgentEvalDetail agentId="ag1" onBack={() => {}} />
    </NextIntlClientProvider>,
  );
}

describe("AgentEvalDetail — AC-39/E-7 the trend chart never uses the vendored default y-domain", () => {
  it("passes LineChart an explicit yMin={0} yMax={1}, not the [0.6,1.0] default that would clip a 0.3 precision point off the chart", () => {
    const dashboard: EvalDashboard = {
      owner_kind: "agent",
      owner_id: "ag1",
      cases_total: 8,
      current: { recall: 0.9, precision: 0.3, citation_accuracy: 0.9, traces_passed: 2, traces_total: 8, cost_usd: 0.02 },
      delta: { recall: 0, precision: -0.6, citation_accuracy: -0.05 },
      trend: [
        { batch_id: "b0", agent_version: 5, ran_at: BATCH_V5.ran_at, recall: 0.9, precision: 0.9, citation_accuracy: 0.95, pass_rate: 0.875, cost_usd: 0.02 },
        { batch_id: "b1", agent_version: 6, ran_at: BATCH_V6_WEAKENED.ran_at, recall: 0.9, precision: 0.3, citation_accuracy: 0.9, pass_rate: 0.25, cost_usd: 0.02 },
      ],
      recent_runs: [BATCH_V6_WEAKENED, BATCH_V5],
      alert: null,
    };
    useAgent.mockReturnValue({ data: AGENT });
    useAgentEvalDashboard.mockReturnValue({ data: dashboard, isLoading: false, isError: false, refetch: vi.fn() });
    useAgentEvalBatches.mockReturnValue({ data: [BATCH_V6_WEAKENED, BATCH_V5] });
    useRunEvalSet.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderDetail();

    expect(screen.getByTestId("line-chart-stub")).toBeInTheDocument();
    expect(capturedLineChartProps).not.toBeNull();
    expect(capturedLineChartProps!.yMin).toBe(0);
    expect(capturedLineChartProps!.yMax).toBe(1);
  });
});

describe("AgentEvalDetail — UX-4/E-11 an undefined metric renders as an explicit n/a, never a flattering score", () => {
  it("recall renders its real 0% (it missed real must_find items) while precision/citation, which are undefined, render n/a with a reason — not 100%", () => {
    const dashboard: EvalDashboard = {
      owner_kind: "agent",
      owner_id: "ag1",
      cases_total: 3,
      current: { recall: 0, precision: null, citation_accuracy: null, traces_passed: 0, traces_total: 3, cost_usd: null },
      delta: null,
      trend: [],
      recent_runs: [],
      alert: null,
    };
    useAgent.mockReturnValue({ data: AGENT });
    useAgentEvalDashboard.mockReturnValue({ data: dashboard, isLoading: false, isError: false, refetch: vi.fn() });
    useAgentEvalBatches.mockReturnValue({ data: [] });
    useRunEvalSet.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderDetail();

    expect(screen.getByText("0%")).toBeInTheDocument();
    const naTiles = screen.getAllByText("n/a");
    expect(naTiles.length).toBe(2); // precision + citation accuracy
    expect(screen.queryByText("100%")).not.toBeInTheDocument();
    // UX-5-adjacent: the reason line explains WHY, appears once per n/a tile.
    expect(screen.getAllByText("no data for this metric on this run").length).toBe(2);
  });
});

describe("AgentEvalDetail — E-17/UX-12 a first batch is 'first run', never a zero delta", () => {
  it("shows 'first run' messaging when dashboard.delta is null and there is <=1 trend point", () => {
    const dashboard: EvalDashboard = {
      owner_kind: "agent",
      owner_id: "ag1",
      cases_total: 8,
      current: { recall: 0.9, precision: 0.9, citation_accuracy: 0.95, traces_passed: 7, traces_total: 8, cost_usd: 0.02 },
      delta: null,
      trend: [
        { batch_id: "b0", agent_version: 5, ran_at: BATCH_V5.ran_at, recall: 0.9, precision: 0.9, citation_accuracy: 0.95, pass_rate: 0.875, cost_usd: 0.02 },
      ],
      recent_runs: [BATCH_V5],
      alert: null,
    };
    useAgent.mockReturnValue({ data: AGENT });
    useAgentEvalDashboard.mockReturnValue({ data: dashboard, isLoading: false, isError: false, refetch: vi.fn() });
    useAgentEvalBatches.mockReturnValue({ data: [BATCH_V5] });
    useRunEvalSet.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderDetail();

    // Phase D fix-loop — this now renders via the shared `compare.firstRunNothing`
    // i18n key (same key the "recent runs" compare bar already used) instead of a
    // hardcoded string, so the copy dropped the old "yet." suffix. With only one
    // batch, BOTH the metrics-row note and the compare bar render this same text
    // (getAllByText, not getByText — there are legitimately two instances).
    expect(screen.getAllByText("First run — nothing to compare").length).toBe(2);
  });

  it("does NOT show first-run messaging once a delta exists (>=2 batches)", () => {
    const dashboard: EvalDashboard = {
      owner_kind: "agent",
      owner_id: "ag1",
      cases_total: 8,
      current: { recall: 0.9, precision: 0.3, citation_accuracy: 0.9, traces_passed: 2, traces_total: 8, cost_usd: 0.02 },
      delta: { recall: 0, precision: -0.6, citation_accuracy: -0.05 },
      trend: [
        { batch_id: "b0", agent_version: 5, ran_at: BATCH_V5.ran_at, recall: 0.9, precision: 0.9, citation_accuracy: 0.95, pass_rate: 0.875, cost_usd: 0.02 },
        { batch_id: "b1", agent_version: 6, ran_at: BATCH_V6_WEAKENED.ran_at, recall: 0.9, precision: 0.3, citation_accuracy: 0.9, pass_rate: 0.25, cost_usd: 0.02 },
      ],
      recent_runs: [BATCH_V6_WEAKENED, BATCH_V5],
      alert: null,
    };
    useAgent.mockReturnValue({ data: AGENT });
    useAgentEvalDashboard.mockReturnValue({ data: dashboard, isLoading: false, isError: false, refetch: vi.fn() });
    useAgentEvalBatches.mockReturnValue({ data: [BATCH_V6_WEAKENED, BATCH_V5] });
    useRunEvalSet.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderDetail();

    expect(screen.queryByText("First run — nothing to compare")).not.toBeInTheDocument();
  });
});

describe("AgentEvalDetail — regression: metric captions read their OWN contributing-case count", () => {
  it("each metric tile's caption shows ITS OWN *_cases field, not cases_total and not another metric's count", () => {
    // All four numbers deliberately distinct so a caption reading the wrong
    // field (e.g. cases_total, or another metric's *_cases) is caught.
    const batch: EvalBatchRecord = {
      ...BATCH_V5,
      cases_total: 11,
      recall_cases: 3,
      precision_cases: 5,
      citation_cases: 9,
    };
    const dashboard: EvalDashboard = {
      owner_kind: "agent",
      owner_id: "ag1",
      cases_total: 20, // owner's whole case set — must NOT appear in any caption
      current: { recall: 0.9, precision: 0.9, citation_accuracy: 0.95, traces_passed: 7, traces_total: 8, cost_usd: 0.02 },
      delta: null,
      trend: [
        { batch_id: "b0", agent_version: 5, ran_at: batch.ran_at, recall: 0.9, precision: 0.9, citation_accuracy: 0.95, pass_rate: 0.875, cost_usd: 0.02 },
      ],
      recent_runs: [batch],
      alert: null,
    };
    useAgent.mockReturnValue({ data: AGENT });
    useAgentEvalDashboard.mockReturnValue({ data: dashboard, isLoading: false, isError: false, refetch: vi.fn() });
    useAgentEvalBatches.mockReturnValue({ data: [batch] });
    useRunEvalSet.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderDetail();

    expect(screen.getByText("3 of 11 cases")).toBeInTheDocument();
    expect(screen.getByText("5 of 11 cases")).toBeInTheDocument();
    expect(screen.getByText("9 of 11 cases")).toBeInTheDocument();
    expect(screen.queryByText("20 of 11 cases")).not.toBeInTheDocument();
    expect(screen.queryByText(/of 20 cases/)).not.toBeInTheDocument();
  });
});

describe("AgentEvalDetail — AC-37 the recent-runs table has exactly the named columns and renders batch rows", () => {
  it("renders ran-at/recall/precision/citation/pass/cost headers, plus the batch's own agent_version and formatted cost", () => {
    const dashboard: EvalDashboard = {
      owner_kind: "agent",
      owner_id: "ag1",
      cases_total: 8,
      current: { recall: 0.9, precision: 0.9, citation_accuracy: 0.95, traces_passed: 7, traces_total: 8, cost_usd: 0.02 },
      delta: null,
      trend: [
        { batch_id: "b0", agent_version: 5, ran_at: BATCH_V5.ran_at, recall: 0.9, precision: 0.9, citation_accuracy: 0.95, pass_rate: 0.875, cost_usd: 0.02 },
      ],
      recent_runs: [BATCH_V5],
      alert: null,
    };
    useAgent.mockReturnValue({ data: AGENT });
    useAgentEvalDashboard.mockReturnValue({ data: dashboard, isLoading: false, isError: false, refetch: vi.fn() });
    useAgentEvalBatches.mockReturnValue({ data: [BATCH_V5] });
    useRunEvalSet.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderDetail();

    for (const header of ["Ran at", "Recall", "Precision", "Citation", "Pass", "Cost"]) {
      expect(screen.getByText(header)).toBeInTheDocument();
    }
    expect(screen.getByText("v5")).toBeInTheDocument();
    expect(screen.getByText("7/8")).toBeInTheDocument();
  });
});
