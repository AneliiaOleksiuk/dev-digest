/**
 * IntentCard — six UI states + stale head-SHA comparison
 * (docs/plans/intent-layer.md work item 8 / Test plan).
 *
 * States: unclassified / loading / classified / stale / unresolved-sources / error.
 * Hooks are mocked at the boundary (`lib/hooks/reviews`); no real API.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrIntentRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

const usePullIntent = vi.fn();
const useRecalculateIntent = vi.fn();

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  usePullIntent: (...args: unknown[]) => usePullIntent(...args),
  useRecalculateIntent: (...args: unknown[]) => useRecalculateIntent(...args),
}));

import { IntentCard } from "./IntentCard";

afterEach(() => {
  cleanup();
  usePullIntent.mockReset();
  useRecalculateIntent.mockReset();
});

const CLASSIFIED: PrIntentRecord = {
  pr_id: "pr-1",
  intent: "Add rate limiting to protect the API from abuse.",
  in_scope: ["rate limiting middleware"],
  out_of_scope: ["auth rewrite"],
  confidence: 0.8,
  sources: [
    { kind: "pr_title", ref: null, resolved: true },
    { kind: "pr_description", ref: null, resolved: true },
    { kind: "changed_files", ref: null, resolved: true },
  ],
  missing_context: [],
  risk_areas: [],
  head_sha: "abc1234",
  provider: "openrouter",
  model: "deepseek/deepseek-v4-flash",
  classified_at: "2026-08-06T12:00:00.000Z",
};

function idleClassify() {
  useRecalculateIntent.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
  });
}

function renderCard(headSha = "abc1234") {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <IntentCard prId="pr-1" headSha={headSha} />
    </NextIntlClientProvider>,
  );
}

describe("IntentCard", () => {
  it("unclassified: empty state + Derive intent action", () => {
    usePullIntent.mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      error: null,
    });
    idleClassify();
    renderCard();

    expect(screen.getByText("Intent")).toBeInTheDocument();
    expect(screen.getByText("No intent derived yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Derive intent/i })).toBeInTheDocument();
  });

  it("loading: shows skeletons while the query is in flight with no record", () => {
    usePullIntent.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
      error: null,
    });
    idleClassify();
    const { container } = renderCard();

    expect(screen.getByText("Intent")).toBeInTheDocument();
    expect(screen.queryByText("No intent derived yet")).not.toBeInTheDocument();
    expect(screen.queryByText(CLASSIFIED.intent)).not.toBeInTheDocument();
    // Skeleton primitives render as elements with height styles — at least one.
    expect(container.querySelectorAll("[style*='height']").length).toBeGreaterThan(0);
  });

  it("classified: shows intent text, in/out of scope, confidence, and model badge", () => {
    usePullIntent.mockReturnValue({
      data: CLASSIFIED,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      error: null,
    });
    idleClassify();
    renderCard("abc1234");

    expect(screen.getByText(CLASSIFIED.intent)).toBeInTheDocument();
    expect(screen.getByText("In scope")).toBeInTheDocument();
    expect(screen.getByText("rate limiting middleware")).toBeInTheDocument();
    expect(screen.getByText("Out of scope")).toBeInTheDocument();
    expect(screen.getByText("auth rewrite")).toBeInTheDocument();
    expect(screen.getByText("Confidence 80%")).toBeInTheDocument();
    expect(screen.getByText("openrouter/deepseek/deepseek-v4-flash")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Re-derive intent/i })).toBeInTheDocument();
    expect(screen.queryByText("PR updated since this was derived")).not.toBeInTheDocument();
  });

  it("stale: record.head_sha !== pr headSha shows update notice + re-derive", () => {
    usePullIntent.mockReturnValue({
      data: CLASSIFIED,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      error: null,
    });
    idleClassify();
    renderCard("zzzz9999"); // current PR head differs from record.head_sha

    expect(screen.getByText("PR updated since this was derived")).toBeInTheDocument();
    expect(screen.getByText(/head commit has moved/i)).toBeInTheDocument();
    expect(screen.getByText(CLASSIFIED.intent)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Re-derive intent/i }).length).toBeGreaterThanOrEqual(1);
  });

  it("unresolved-sources: marks unresolved sources and shows missing_context", () => {
    const withUnresolved: PrIntentRecord = {
      ...CLASSIFIED,
      confidence: 0.5,
      sources: [
        { kind: "pr_title", ref: null, resolved: true },
        {
          kind: "external_link",
          ref: "https://jira.example/ABC-1",
          resolved: false,
        },
        { kind: "spec_file", ref: "specs/missing.md", resolved: false },
      ],
      missing_context: [
        "https://jira.example/ABC-1 could not be retrieved",
        "specs/missing.md could not be retrieved (no local clone)",
      ],
    };
    usePullIntent.mockReturnValue({
      data: withUnresolved,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      error: null,
    });
    idleClassify();
    renderCard();

    expect(screen.getByText("Missing context")).toBeInTheDocument();
    expect(screen.getByText("https://jira.example/ABC-1 could not be retrieved")).toBeInTheDocument();
    // WI11 (docs/plans/intent-layer.md): copy renamed "Sources"/"Resolved"/
    // "Unresolved" → the collapsed toggle shows a source count and each row
    // reads "Fetched"/"Unavailable" so it can't be misread as "no problem".
    expect(screen.getByText("3 sources")).toBeInTheDocument();
    expect(screen.getByText("External link")).toBeInTheDocument();
    expect(screen.getByText("https://jira.example/ABC-1")).toBeInTheDocument();
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Confidence 50%")).toBeInTheDocument();
  });

  it("sources: collapsed by default behind a native <details> toggle (WI11 item 5)", () => {
    usePullIntent.mockReturnValue({
      data: CLASSIFIED, // 3 resolved sources
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      error: null,
    });
    idleClassify();
    const { container } = renderCard();

    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details!.open).toBe(false);
    expect(screen.getByText("3 sources")).toBeInTheDocument();
  });

  it("risk areas: renders the Risk Areas subsection with each bullet when non-empty", () => {
    const withRisks: PrIntentRecord = {
      ...CLASSIFIED,
      risk_areas: ["New dependency: ioredis", "Auth surface touched"],
    };
    usePullIntent.mockReturnValue({
      data: withRisks,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      error: null,
    });
    idleClassify();
    renderCard();

    expect(screen.getByText("Risk areas")).toBeInTheDocument();
    expect(screen.getByText("New dependency: ioredis")).toBeInTheDocument();
    expect(screen.getByText("Auth surface touched")).toBeInTheDocument();
  });

  it("risk areas: omits the subsection entirely when risk_areas is empty (no 'No risks' filler)", () => {
    usePullIntent.mockReturnValue({
      data: CLASSIFIED, // risk_areas: []
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      error: null,
    });
    idleClassify();
    renderCard();

    expect(screen.queryByText("Risk areas")).not.toBeInTheDocument();
  });

  it("missing context: truncates the first item and shows a '+N more' line for the rest", () => {
    const long =
      "This spec reference could not be resolved because the repository clone does not exist locally and no fallback fetch mechanism is configured for this workspace, so the classifier proceeded without it.";
    const withMany: PrIntentRecord = {
      ...CLASSIFIED,
      missing_context: [long, "second missing item", "third missing item"],
    };
    usePullIntent.mockReturnValue({
      data: withMany,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      error: null,
    });
    idleClassify();
    renderCard();

    // Full untruncated text must not appear — only the ~160-char, word-boundary
    // truncated version (ending in an ellipsis) is shown.
    expect(screen.queryByText(long)).not.toBeInTheDocument();
    expect(screen.getByText(/…$/)).toBeInTheDocument();
    // Missing context must not outrank objective/scope/risks (WI11 item 6) —
    // only the first item's (truncated) text renders; the rest collapse into
    // a "+N more" count, never a full multi-item list.
    expect(screen.queryByText("second missing item")).not.toBeInTheDocument();
    expect(screen.queryByText("third missing item")).not.toBeInTheDocument();
    expect(screen.getByText("+2 more")).toBeInTheDocument();
  });

  it("error: load failure shows ErrorState when there is no cached record", () => {
    usePullIntent.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
      error: new Error("network down"),
    });
    idleClassify();
    renderCard();

    expect(screen.getByText("Couldn’t load intent")).toBeInTheDocument();
    expect(screen.getByText("network down")).toBeInTheDocument();
    expect(screen.queryByText("No intent derived yet")).not.toBeInTheDocument();
  });
});
