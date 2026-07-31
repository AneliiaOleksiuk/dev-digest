import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrMeta, ReviewRecord } from "@devdigest/shared";
import messages from "../../../../../../../../../messages/en/prReview.json";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const usePrLatestFindings = vi.fn();
vi.mock("@/lib/hooks/reviews", () => ({
  usePrLatestFindings: (...args: unknown[]) => usePrLatestFindings(...args),
}));

import { FindingsPreview } from "./FindingsPreview";

afterEach(() => {
  cleanup();
  push.mockClear();
  usePrLatestFindings.mockReset();
});

const PULL_REQUEST: PrMeta = {
  id: "pr1",
  number: 482,
  title: "Add rate limiting to public API endpoints",
  author: "marisa.koch",
  branch: "feat/rate-limit-public",
  base: "main",
  head_sha: "abc123",
  additions: 247,
  deletions: 38,
  files_count: 9,
  status: "needs_review",
  opened_at: null,
  updated_at: null,
  score: 61,
  cost_usd: null,
  critical_count: 2,
  warning_count: 1,
  suggestion_count: 0,
};

const REVIEWS: ReviewRecord[] = [
  {
    id: "review1",
    kind: "review",
    pr_id: "pr1",
    agent_id: "a1",
    run_id: "run1",
    agent_name: "Security Reviewer",
    summary: null,
    verdict: "request_changes",
    score: 38,
    model: "deepseek/deepseek-v4-flash",
    created_at: "2026-06-13T20:52:51.000Z",
    findings: [
      {
        id: "f1",
        severity: "CRITICAL",
        category: "security",
        title: "Hardcoded Stripe secret key",
        file: "src/config.ts",
        start_line: 12,
        end_line: 12,
        rationale: "A live Stripe key is committed in source.",
        suggestion: null,
        confidence: 0.98,
        kind: "finding",
        trifecta_components: null,
        evidence: null,
        review_id: "review1",
        accepted_at: null,
        dismissed_at: null,
      },
    ],
  },
];

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingsPreview", () => {
  it("renders one severity badge per non-zero count as the hover trigger", () => {
    usePrLatestFindings.mockReturnValue({ data: undefined, isLoading: false });
    renderWithIntl(<FindingsPreview pullRequest={PULL_REQUEST} repoId="repo1" />);
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("hovering opens a popover listing the latest review's findings", async () => {
    vi.useFakeTimers();
    usePrLatestFindings.mockReturnValue({ data: REVIEWS, isLoading: false });
    const { container } = renderWithIntl(<FindingsPreview pullRequest={PULL_REQUEST} repoId="repo1" />);

    fireEvent.mouseEnter(container.firstChild as Element);
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
    expect(screen.getByText("src/config.ts:12")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("clicking a finding row navigates to the Findings tab, deep-linked to that run + finding", async () => {
    vi.useFakeTimers();
    usePrLatestFindings.mockReturnValue({ data: REVIEWS, isLoading: false });
    const { container } = renderWithIntl(<FindingsPreview pullRequest={PULL_REQUEST} repoId="repo1" />);

    fireEvent.mouseEnter(container.firstChild as Element);
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    fireEvent.click(screen.getByText("Hardcoded Stripe secret key"));

    expect(push).toHaveBeenCalledWith("/repos/repo1/pulls/482?tab=findings&run=run1&finding=f1");
    vi.useRealTimers();
  });
});
