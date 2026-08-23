/**
 * RunHistory — the badge must reflect the review OUTCOME, not the run lifecycle.
 * Regression guard for the "green ✓ done on a run that found 5 blockers" bug:
 * a settled run is colored/labelled by its denormalized blocker/finding counts,
 * and shows the review score ring.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunSummary } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { RunHistory } from "./RunHistory";

afterEach(cleanup);

function run(o: Partial<RunSummary>): RunSummary {
  return {
    run_id: "run-1",
    agent_id: "a1",
    agent_name: "Security Reviewer",
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    status: "done",
    error: null,
    duration_ms: 1000,
    tokens_in: 100,
    tokens_out: 50,
    cost_usd: null,
    findings_count: 0,
    grounding: "0/0 passed",
    ran_at: "2026-06-11T18:44:34.000Z",
    score: null,
    blockers: null,
    critical_count: null,
    warning_count: null,
    suggestion_count: null,
    ...o,
  };
}

function renderRuns(runs: RunSummary[], extraProps: Partial<React.ComponentProps<typeof RunHistory>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <RunHistory runs={runs} onOpenTrace={() => {}} {...extraProps} />
    </NextIntlClientProvider>,
  );
}

describe("RunHistory — outcome badge", () => {
  it("a done run WITH blockers reads 'rejected' (never green 'done') + shows the score ring", () => {
    renderRuns([run({ status: "done", findings_count: 5, blockers: 5, score: 0 })]);
    expect(screen.getByText("rejected")).toBeInTheDocument();
    expect(screen.queryByText("done")).not.toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument(); // CircularScore renders the number
    expect(screen.getByText(/5 blockers/)).toBeInTheDocument();
  });

  it("a clean done run reads 'approved'", () => {
    renderRuns([run({ status: "done", findings_count: 0, blockers: 0, score: 95 })]);
    expect(screen.getByText("approved")).toBeInTheDocument();
    expect(screen.getByText("95")).toBeInTheDocument();
  });

  it("a done run with non-blocking findings reads 'reviewed'", () => {
    renderRuns([run({ status: "done", findings_count: 3, blockers: 0, score: 72 })]);
    expect(screen.getByText("reviewed")).toBeInTheDocument();
    expect(screen.queryByText(/blockers/)).not.toBeInTheDocument();
  });

  it("shows one severity badge per non-zero count for a run with mixed findings", () => {
    renderRuns([
      run({
        status: "done",
        findings_count: 3,
        blockers: 1,
        score: 61,
        critical_count: 1,
        warning_count: 1,
        suggestion_count: 1,
      }),
    ]);
    expect(screen.getAllByText("1")).toHaveLength(3); // one count per severity badge
    expect(screen.getByText(/1 blockers/)).toBeInTheDocument();
  });

  it("clicking a severity badge calls onSeverityClick with the run id + that severity", () => {
    const onSeverityClick = vi.fn();
    renderRuns(
      [run({ status: "done", findings_count: 1, blockers: 0, score: 90, warning_count: 1 })],
      { onSeverityClick },
    );
    fireEvent.click(screen.getByText("1"));
    expect(onSeverityClick).toHaveBeenCalledWith("run-1", "WARNING");
  });

  it("clicking the blockers text calls onSeverityClick with CRITICAL", () => {
    const onSeverityClick = vi.fn();
    renderRuns(
      [run({ status: "done", findings_count: 2, blockers: 2, score: 10, critical_count: 2 })],
      { onSeverityClick },
    );
    fireEvent.click(screen.getByText(/2 blockers/));
    expect(onSeverityClick).toHaveBeenCalledWith("run-1", "CRITICAL");
  });

  it("a failed run reads 'error'", () => {
    renderRuns([run({ status: "failed", error: "boom", score: null, blockers: null })]);
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("a running run reads 'running'", () => {
    renderRuns([run({ status: "running", score: null, blockers: null })]);
    expect(screen.getByText("running")).toBeInTheDocument();
  });
});
