/**
 * PrBriefBanner — Overview's full-width "PR Brief" panel, panel 1 of 3
 * (docs/plans/intent-layer.md WI13 / Test plan): classified-review case
 * with/without cost, and the honest "no review yet" empty state (never a
 * fabricated Brief). Hooks are mocked at the boundary (`lib/hooks/reviews`);
 * VerdictBanner itself is NOT mocked, so this also proves the wiring through
 * the real reused child (see `VerdictBanner/VerdictBanner.test.tsx` for the
 * sibling pattern this follows).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, ReviewRecord, RunSummary } from "@devdigest/shared";
import prReviewMessages from "../../../../../../../../../../messages/en/prReview.json";
import briefMessages from "../../../../../../../../../../messages/en/brief.json";

const usePrReviews = vi.fn();
const usePrRuns = vi.fn();

vi.mock("../../../../../../../../../lib/hooks/reviews", () => ({
  usePrReviews: (...args: unknown[]) => usePrReviews(...args),
  usePrRuns: (...args: unknown[]) => usePrRuns(...args),
}));

import { PrBriefBanner } from "./PrBriefBanner";

afterEach(() => {
  cleanup();
  usePrReviews.mockReset();
  usePrRuns.mockReset();
});

function renderBanner() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: prReviewMessages, brief: briefMessages }}>
      <PrBriefBanner prId="pr-1" />
    </NextIntlClientProvider>,
  );
}

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded secret",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A secret is committed.",
  suggestion: null,
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "rev-1",
  accepted_at: null,
  dismissed_at: null,
};

const REVIEW: ReviewRecord = {
  id: "rev-1",
  pr_id: "pr-1",
  agent_id: "agent-1",
  run_id: "run-1",
  agent_name: "Security Reviewer",
  kind: "review",
  verdict: "request_changes",
  summary: "Hardcoded secret introduced.",
  score: 42,
  model: "gpt-4.1",
  grounding: null,
  created_at: "2026-08-06T12:00:00.000Z",
  findings: [FINDING],
};

const RUN: RunSummary = {
  run_id: "run-1",
  agent_id: "agent-1",
  agent_name: "Security Reviewer",
  provider: "openai",
  model: "gpt-4.1",
  status: "done",
  error: null,
  duration_ms: 1200,
  tokens_in: 800,
  tokens_out: 200,
  cost_usd: 0.42,
  findings_count: 1,
  grounding: null,
  ran_at: "2026-08-06T12:00:00.000Z",
  score: 42,
  blockers: 1,
  critical_count: 1,
  warning_count: 0,
  suggestion_count: 0,
};

describe("PrBriefBanner", () => {
  it("classified: shows verdict/findings/score and the matching run's cost", () => {
    usePrReviews.mockReturnValue({ data: [REVIEW] });
    usePrRuns.mockReturnValue({ data: [RUN] });
    renderBanner();

    expect(screen.getByText("Request changes")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText(/1 findings · 1 blockers/)).toBeInTheDocument();
    expect(screen.getByText("$0.42")).toBeInTheDocument();
  });

  it("classified: omits the cost badge when no run matches — never invents a figure", () => {
    usePrReviews.mockReturnValue({ data: [REVIEW] });
    usePrRuns.mockReturnValue({ data: [] }); // no RunSummary row matches REVIEW.run_id
    renderBanner();

    expect(screen.getByText("Request changes")).toBeInTheDocument();
    expect(screen.queryByText(/^\$/)).not.toBeInTheDocument();
  });

  it("no review yet: shows the honest Brief empty state, not a fabricated verdict", () => {
    usePrReviews.mockReturnValue({ data: [] });
    usePrRuns.mockReturnValue({ data: [] });
    renderBanner();

    expect(screen.getByText("Brief not available yet.")).toBeInTheDocument();
    expect(screen.getByText("Run a review or open the PR to compute it.")).toBeInTheDocument();
    expect(screen.queryByText("Request changes")).not.toBeInTheDocument();
    expect(screen.queryByText("42")).not.toBeInTheDocument();
  });
});
