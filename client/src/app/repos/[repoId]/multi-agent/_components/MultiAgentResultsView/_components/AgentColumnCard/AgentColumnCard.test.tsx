import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentColumn } from "@devdigest/shared";
import type { AgentVisual } from "../../../../agent-visuals";
import messages from "../../../../../../../../../messages/en/runs.json";

vi.mock("@/lib/hooks/reviews", () => ({
  useRunEvents: () => ({ events: [], running: false }),
}));

import { AgentColumnCard } from "./AgentColumnCard";

afterEach(cleanup);

const VISUAL: AgentVisual = { icon: "Shield", color: "var(--crit)" };

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
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
    summary: "Looks fine.",
    error: null,
    duration_ms: 8200,
    cost_usd: 0.06,
    findings: [],
    ...overrides,
  };
}

describe("AgentColumnCard (smoke)", () => {
  it("shows a done column's score/findings/duration/cost", () => {
    renderWithIntl(<AgentColumnCard column={column()} visual={VISUAL} onOpenTrace={vi.fn()} />);
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("82")).toBeInTheDocument();
    expect(screen.getByText("8s")).toBeInTheDocument();
    expect(screen.getByText("$0.06")).toBeInTheDocument();
  });

  it("shows the persisted error text inline for a failed column, not a global toast", () => {
    renderWithIntl(
      <AgentColumnCard
        column={column({ status: "failed", error: "Provider timed out after 3 retries.", score: null })}
        visual={VISUAL}
        onOpenTrace={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Provider timed out after 3 retries.");
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("shows the persisted error/reason text inline for a CANCELLED column too, not just failed", () => {
    renderWithIntl(
      <AgentColumnCard
        column={column({ status: "cancelled", error: "Cancelled: another agent hit a critical finding.", score: null })}
        visual={VISUAL}
        onOpenTrace={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Cancelled: another agent hit a critical finding.");
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
  });

  it("status is never color-only — a text label always renders alongside the icon", () => {
    renderWithIntl(
      <AgentColumnCard column={column({ status: "cancelled", error: null })} visual={VISUAL} onOpenTrace={vi.fn()} />,
    );
    // The status chip AND the error box's fallback text both read "Cancelled"
    // with no persisted `error` — assert at least one text label rendered
    // rather than requiring exactly one, since this test only cares that a
    // text label is present (never color-only), not the exact count.
    expect(screen.getAllByText("Cancelled").length).toBeGreaterThan(0);
  });

  it("calls onOpenTrace from the footer button", () => {
    const onOpenTrace = vi.fn();
    renderWithIntl(<AgentColumnCard column={column()} visual={VISUAL} onOpenTrace={onOpenTrace} />);
    fireEvent.click(screen.getByText("View trace"));
    expect(onOpenTrace).toHaveBeenCalled();
  });

  it("renders the live log while running, not the settled summary", () => {
    renderWithIntl(
      <AgentColumnCard column={column({ status: "running", score: null, summary: null })} visual={VISUAL} onOpenTrace={vi.fn()} />,
    );
    expect(screen.getAllByText("Running").length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText("Filter log…")).toBeInTheDocument();
  });
});
