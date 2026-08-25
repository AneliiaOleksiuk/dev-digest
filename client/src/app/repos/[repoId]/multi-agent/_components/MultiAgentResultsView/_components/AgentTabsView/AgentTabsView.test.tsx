import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentColumn, FindingRecord, ReviewRecord } from "@devdigest/shared";
import runsMessages from "../../../../../../../../../messages/en/runs.json";
import prReviewMessages from "../../../../../../../../../messages/en/prReview.json";

vi.mock("@/lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/hooks/multi-agent", () => ({
  useTurnIntoEvalCase: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { AgentTabsView } from "./AgentTabsView";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: runsMessages, prReview: prReviewMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function finding(overrides: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: "f1",
    severity: "WARNING",
    category: "bug",
    title: "N+1 query",
    file: "src/api/users.ts",
    start_line: 45,
    end_line: 45,
    rationale: "Loops.",
    suggestion: null,
    confidence: 0.8,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...overrides,
  };
}

function column(overrides: Partial<AgentColumn> = {}): AgentColumn {
  return {
    run_id: "run-1",
    agent_id: "a1",
    agent_name: "Security Reviewer",
    provider: "openai",
    model: "gpt-4.1",
    status: "done",
    verdict: "comment",
    score: 82,
    summary: "ok",
    duration_ms: 8200,
    cost_usd: 0.06,
    findings: [],
    ...overrides,
  };
}

function review(overrides: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    id: "rev-1",
    pr_id: "pr-1",
    agent_id: "a1",
    run_id: "run-1",
    agent_name: "Security Reviewer",
    kind: "review",
    verdict: "comment",
    summary: "ok",
    score: 82,
    model: "gpt-4.1",
    grounding: null,
    created_at: "2026-01-01T00:00:00.000Z",
    findings: [finding()],
    ...overrides,
  };
}

describe("AgentTabsView (smoke)", () => {
  it("shows only the active tab's own findings", () => {
    const columns = [column(), column({ run_id: "run-2", agent_id: "a2", agent_name: "Style Reviewer" })];
    const reviews = [review(), review({ id: "rev-2", run_id: "run-2", findings: [] })];
    renderWithIntl(<AgentTabsView columns={columns} reviews={reviews} prId="pr-1" onOpenTrace={vi.fn()} />);
    expect(screen.getByText("N+1 query")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Style Reviewer"));
    expect(screen.queryByText("N+1 query")).not.toBeInTheDocument();
    expect(screen.getByText("No findings.")).toBeInTheDocument();
  });

  it("wires View trace to the shared onOpenTrace callback with the active run id", () => {
    const onOpenTrace = vi.fn();
    renderWithIntl(<AgentTabsView columns={[column()]} reviews={[review()]} prId="pr-1" onOpenTrace={onOpenTrace} />);
    fireEvent.click(screen.getByText("View trace"));
    expect(onOpenTrace).toHaveBeenCalledWith("run-1");
  });
});
