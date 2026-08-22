import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { MultiAgentRun } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/runs.json";

let runData: MultiAgentRun | undefined;
let isErrorFlag = false;
const refetch = vi.fn();

vi.mock("@/lib/hooks/multi-agent", () => ({
  useMultiAgentRun: () => ({ data: runData, isLoading: false, isError: isErrorFlag, refetch }),
}));
vi.mock("@/lib/hooks/reviews", () => ({
  usePrReviews: () => ({ data: [] }),
}));
vi.mock("@/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer", () => ({
  RunTraceDrawer: ({ runId, onClose }: { runId: string; onClose: () => void }) => (
    <div>
      <span>trace drawer for {runId}</span>
      <button onClick={onClose}>close drawer</button>
    </div>
  ),
}));
vi.mock("./_components/AgentColumnCard", () => ({
  AgentColumnCard: ({ column, onOpenTrace }: { column: { run_id: string; agent_name: string }; onOpenTrace: () => void }) => (
    <div>
      <span>column: {column.agent_name}</span>
      <button onClick={onOpenTrace}>trace for {column.run_id}</button>
    </div>
  ),
}));
vi.mock("./_components/AgentTabsView", () => ({
  AgentTabsView: () => <div>tabs view</div>,
}));
vi.mock("./_components/FindingGroupsSection", () => ({
  FindingGroupsSection: () => <div>groups section</div>,
}));
vi.mock("./_components/DisagreementSection", () => ({
  DisagreementSection: () => <div>disagreement section</div>,
}));

import { MultiAgentResultsView } from "./MultiAgentResultsView";

afterEach(() => {
  cleanup();
  runData = undefined;
  isErrorFlag = false;
  refetch.mockReset();
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function run(overrides: Partial<MultiAgentRun> = {}): MultiAgentRun {
  return {
    id: "batch-1",
    pr_id: "pr-1",
    pr_number: 42,
    ran_at: "2026-01-01T00:00:00.000Z",
    agent_count: 2,
    total_duration_ms: 15000,
    total_cost_usd: 0.08,
    total_cost_partial: false,
    columns: [
      { run_id: "run-1", agent_id: "a1", agent_name: "Security", provider: "openai", model: "gpt-4.1", status: "done", verdict: "comment", score: 82, summary: "ok", duration_ms: 8200, cost_usd: 0.06, findings: [] },
      { run_id: "run-2", agent_id: "a2", agent_name: "Style", provider: "openai", model: "gpt-4.1", status: "running", verdict: null, score: null, summary: null, duration_ms: null, cost_usd: null, findings: [] },
    ],
    groups: [],
    conflicts: [],
    ...overrides,
  };
}

describe("MultiAgentResultsView (smoke)", () => {
  it("defaults to the Columns layout and renders one card per column", () => {
    runData = run();
    renderWithIntl(<MultiAgentResultsView runId="batch-1" onBack={vi.fn()} />);
    expect(screen.getByText("column: Security")).toBeInTheDocument();
    expect(screen.getByText("column: Style")).toBeInTheDocument();
    expect(screen.queryByText("tabs view")).not.toBeInTheDocument();
  });

  it("switches to the Tabs layout without touching the shared groups/disagreement sections", () => {
    runData = run();
    renderWithIntl(<MultiAgentResultsView runId="batch-1" onBack={vi.fn()} />);
    fireEvent.click(screen.getByText("tabs"));
    expect(screen.getByText("tabs view")).toBeInTheDocument();
    expect(screen.getByText("groups section")).toBeInTheDocument();
    expect(screen.getByText("disagreement section")).toBeInTheDocument();
  });

  it("mounts exactly ONE trace drawer, driven by ONE shared openRunId set from a column's trace trigger", () => {
    runData = run();
    renderWithIntl(<MultiAgentResultsView runId="batch-1" onBack={vi.fn()} />);
    expect(screen.queryByText(/trace drawer for/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("trace for run-1"));
    expect(screen.getAllByText(/trace drawer for/)).toHaveLength(1);
    expect(screen.getByText("trace drawer for run-1")).toBeInTheDocument();
    fireEvent.click(screen.getByText("close drawer"));
    expect(screen.queryByText(/trace drawer for/)).not.toBeInTheDocument();
  });

  it("badges a partial total cost (OQ-1) instead of silently under-counting it", () => {
    runData = run({ total_cost_partial: true });
    renderWithIntl(<MultiAgentResultsView runId="batch-1" onBack={vi.fn()} />);
    expect(screen.getByText("partial")).toBeInTheDocument();
  });

  it("shows an error state with retry when the batch fails to load", () => {
    isErrorFlag = true;
    renderWithIntl(<MultiAgentResultsView runId="batch-1" onBack={vi.fn()} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Retry"));
    expect(refetch).toHaveBeenCalled();
  });
});
