/**
 * PrBriefCard (SPEC-03, WI11). Oracle derived from the Spec/Plan BEFORE this
 * component was opened for wiring facts:
 *   - AC-2: no request fires on mount of the empty (absent) state —
 *     asserted here as "the generate mutation is never invoked on mount".
 *   - WI11 DoD: each of the 6 BriefState values renders visibly
 *     distinguishable content — one test per state.
 *   - budget_exceeded's rendered text must explicitly state nothing was
 *     spent/charged.
 *   - AC-29/AC-30: review_focus renders as an ordered, activatable list;
 *     activating a navigable entry calls onFocusDiffLine(path,line).
 *   - AC-31: a review_focus entry whose file isn't in the currently loaded
 *     changed-file set degrades to non-navigating/disabled, never fires
 *     onFocusDiffLine.
 *   - AC-32/E-21: the score gauge (VerdictBanner) renders ONLY when a
 *     completed review exists, is OMITTED (not a placeholder) otherwise,
 *     and the risk_level badge must not read as the same measurement.
 *   - AC-35/WI10: the newly-added `brief.*` keys must not collide with the
 *     pre-existing keys, and `brief.why.*` (git-why, a different feature)
 *     must be completely untouched.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import briefMessages from "../../../../../../../../../../messages/en/brief.json";
import prReviewMessages from "../../../../../../../../../../messages/en/prReview.json";
import type { BriefRecord, BriefResponse, FocusDiffLineOptions } from "@/lib/types";
import type { ReviewRecord } from "@devdigest/shared";

const usePrBrief = vi.fn();
const useGeneratePrBrief = vi.fn();
const usePrReviews = vi.fn();

vi.mock("@/lib/hooks/brief", () => ({
  usePrBrief: (...args: unknown[]) => usePrBrief(...args),
  useGeneratePrBrief: (...args: unknown[]) => useGeneratePrBrief(...args),
}));

vi.mock("@/lib/hooks/reviews", () => ({
  usePrReviews: (...args: unknown[]) => usePrReviews(...args),
}));

// BriefTimeline fetches lazily on its own — stub it out so these tests focus
// on PrBriefCard's own state machine, not the timeline's (covered by
// BriefTimeline.test.tsx).
vi.mock("./_components/BriefTimeline", () => ({
  BriefTimeline: () => null,
}));

import { PrBriefCard } from "./PrBriefCard";

afterEach(() => {
  cleanup();
  usePrBrief.mockReset();
  useGeneratePrBrief.mockReset();
  usePrReviews.mockReset();
});

function record(overrides: Partial<BriefRecord> = {}): BriefRecord {
  return {
    what: "Adds rate limiting middleware to the public API.",
    why: "Protects the API from abuse per the linked issue.",
    risk_level: "medium",
    risks: [],
    review_focus: [
      { path: "src/config.ts", line: 11, reason: "Rate-limit config lives here." },
      { path: "src/deleted-file.ts", line: 5, reason: "No longer in the diff." },
    ],
    pr_id: "pr-1",
    head_sha: "sha-current-1234567",
    generated_at: "2026-08-01T00:00:00.000Z",
    input_status: {
      intent_status: "used",
      blast_status: "full",
      changed_file_count: 1,
      spec_files_used: [],
      spec_files_unresolved: [],
      linked_issue_status: "not_referenced",
      dropped_inputs: [],
    },
    usage: {
      provider: "openai",
      model: "gpt-4.1",
      input_tokens: 500,
      tokens_in: 400,
      tokens_out: 100,
      cost_usd: 0.02,
      dropped_risk_refs: 0,
      dropped_focus_items: 0,
    },
    ...overrides,
  };
}

function response(overrides: Partial<BriefResponse> = {}): BriefResponse {
  return {
    state: "absent",
    current_head_sha: "sha-current-1234567",
    record: null,
    reused: true,
    reason: null,
    ...overrides,
  };
}

function reviewFixture(overrides: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    id: "rev-1",
    pr_id: "pr-1",
    agent_id: null,
    run_id: null,
    agent_name: "Security Reviewer",
    kind: "review",
    verdict: "approve",
    summary: "Looks fine.",
    score: 88,
    model: "gpt-4.1",
    created_at: "2026-08-01T00:00:00.000Z",
    findings: [],
    ...overrides,
  };
}

const defaultMutate = vi.fn();

function setupHooks(opts: {
  brief?: Partial<ReturnType<typeof usePrBrief>>;
  generate?: Partial<ReturnType<typeof useGeneratePrBrief>>;
  reviews?: ReviewRecord[];
} = {}) {
  usePrBrief.mockReturnValue({
    data: response(),
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...opts.brief,
  });
  useGeneratePrBrief.mockReturnValue({
    data: undefined,
    isPending: false,
    mutate: defaultMutate,
    ...opts.generate,
  });
  usePrReviews.mockReturnValue({ data: opts.reviews ?? [] });
}

function renderCard(onFocusDiffLine: (opts: FocusDiffLineOptions) => void = vi.fn()) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: briefMessages, prReview: prReviewMessages }}>
      <PrBriefCard
        prId="pr-1"
        headSha="sha-current-1234567"
        changedFilePaths={["src/config.ts"]}
        onFocusDiffLine={onFocusDiffLine}
      />
    </NextIntlClientProvider>,
  );
}

describe("PrBriefCard — WI11: all 6 BriefState values render distinguishable content", () => {
  it("absent: shows the empty state + a Generate CTA, no brief content", () => {
    defaultMutate.mockClear();
    setupHooks({ brief: { data: response({ state: "absent" }) } });
    renderCard();
    expect(screen.getByText("No brief yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate" })).toBeInTheDocument();
    expect(screen.queryByText("What")).not.toBeInTheDocument();
  });

  it("AC-2: mounting the absent state issues NO generate request — mutate is never called on render", () => {
    defaultMutate.mockClear();
    setupHooks({ brief: { data: response({ state: "absent" }) } });
    renderCard();
    expect(defaultMutate).not.toHaveBeenCalled();
  });

  it("current: shows what/why/risk badge + which commit it describes + Regenerate", () => {
    setupHooks({ brief: { data: response({ state: "current", record: record() }) } });
    renderCard();
    expect(screen.getByText("Adds rate limiting middleware to the public API.")).toBeInTheDocument();
    expect(screen.getByText("Protects the API from abuse per the linked issue.")).toBeInTheDocument();
    expect(screen.getByText("Medium risk")).toBeInTheDocument();
    expect(screen.getByText(/Describes commit/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeInTheDocument();
  });

  it("stale: shows the stale banner naming the described SHA, distinct from current — content is still visible", () => {
    const r = record({ head_sha: "sha-old-999999" });
    setupHooks({
      brief: {
        data: response({
          state: "stale",
          record: r,
          reason: "This brief describes an earlier commit (sha-old-999999) — the PR has moved since it was generated.",
        }),
      },
    });
    renderCard();
    expect(screen.getByText("Brief is stale")).toBeInTheDocument();
    expect(screen.getAllByText(/sha-old/).length).toBeGreaterThan(0); // shortSha() truncates to 7 chars
    // Content from the stale record is STILL rendered, not hidden.
    expect(screen.getByText("Adds rate limiting middleware to the public API.")).toBeInTheDocument();
  });

  it("corrupt: shows the corrupt banner + Regenerate, and NO brief content (record is null)", () => {
    setupHooks({ brief: { data: response({ state: "corrupt", record: null, reason: "corrupted" }) } });
    renderCard();
    expect(screen.getByText("Couldn't read the stored brief")).toBeInTheDocument();
    expect(screen.queryByText("Adds rate limiting middleware to the public API.")).not.toBeInTheDocument();
  });

  it("budget_exceeded: rendered text explicitly states nothing was spent/charged", () => {
    setupHooks({
      generate: {
        data: response({
          state: "budget_exceeded",
          record: null,
          reused: false,
          reason: "The composed inputs alone exceed the 8,000-token budget — no call was made and nothing was charged.",
        }),
      },
    });
    renderCard();
    expect(screen.getByText("Inputs exceed the budget")).toBeInTheDocument();
    expect(screen.getByText(/nothing was charged/)).toBeInTheDocument();
  });

  it("failed: shows the failed banner, distinct from budget_exceeded", () => {
    setupHooks({
      generate: {
        data: response({
          state: "failed",
          record: null,
          reused: false,
          reason: "The last generation attempt failed. Any previously stored brief for this commit is unchanged.",
        }),
      },
    });
    renderCard();
    expect(screen.getByText("Generation failed")).toBeInTheDocument();
    expect(screen.queryByText("Inputs exceed the budget")).not.toBeInTheDocument();
  });
});

describe("PrBriefCard — AC-29/AC-30/AC-31: review focus list, deep-link activation, degrade when file is gone", () => {
  it("AC-29: renders each review_focus entry with path:line and its reason", () => {
    setupHooks({ brief: { data: response({ state: "current", record: record() }) } });
    renderCard();
    expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
    expect(screen.getByText("Rate-limit config lives here.")).toBeInTheDocument();
  });

  it("AC-30: activating a NAVIGABLE entry (its file IS in changedFilePaths) calls onFocusDiffLine(path,line)", () => {
    const onFocusDiffLine = vi.fn();
    setupHooks({ brief: { data: response({ state: "current", record: record() }) } });
    renderCard(onFocusDiffLine);
    fireEvent.click(screen.getByText("src/config.ts:11"));
    expect(onFocusDiffLine).toHaveBeenCalledWith({ path: "src/config.ts", line: 11 });
  });

  it("AC-31: an entry whose file is NOT in changedFilePaths is disabled and never fires onFocusDiffLine", () => {
    const onFocusDiffLine = vi.fn();
    setupHooks({ brief: { data: response({ state: "current", record: record() }) } });
    renderCard(onFocusDiffLine);
    const disabledButton = screen.getByText("src/deleted-file.ts:5").closest("button")!;
    expect(disabledButton).toBeDisabled();
    fireEvent.click(disabledButton);
    expect(onFocusDiffLine).not.toHaveBeenCalled();
  });
});

describe("PrBriefCard — AC-32/E-21: score gauge vs risk_level are distinct measurements", () => {
  it("a completed review WITH a verdict renders the score gauge (VerdictBanner) alongside the risk_level badge", () => {
    setupHooks({
      brief: { data: response({ state: "current", record: record({ risk_level: "high" }) }) },
      reviews: [reviewFixture({ score: 88, verdict: "approve" })],
    });
    renderCard();
    expect(screen.getByText("PR SCORE")).toBeInTheDocument(); // VerdictBanner's gauge label
    expect(screen.getByText("High risk")).toBeInTheDocument(); // the model's risk_level badge
  });

  it("no completed review → the score gauge is OMITTED entirely (not a placeholder), risk_level still shows", () => {
    setupHooks({
      brief: { data: response({ state: "current", record: record({ risk_level: "low" }) }) },
      reviews: [],
    });
    renderCard();
    expect(screen.queryByText("PR SCORE")).not.toBeInTheDocument();
    expect(screen.getByText("Low risk")).toBeInTheDocument();
  });

  it("a review that exists but has no verdict yet (kind=summary / verdict null) also omits the gauge", () => {
    setupHooks({
      brief: { data: response({ state: "current", record: record() }) },
      reviews: [reviewFixture({ kind: "summary", verdict: null, score: null })],
    });
    renderCard();
    expect(screen.queryByText("PR SCORE")).not.toBeInTheDocument();
  });
});

describe("PrBriefCard — AC-35/WI10: brief.json key collisions and the reserved git-why subtree", () => {
  it("pre-existing top-level keys are unchanged", () => {
    expect(briefMessages.title).toBe("PR Brief");
    expect(briefMessages.unavailable).toBe("Brief not available yet.");
    expect(briefMessages.unavailableHint).toBe("Run a review or open the PR to compute it.");
    expect(briefMessages.noRisks).toBe("No notable risks flagged.");
    expect(briefMessages.noHistory).toBe("No prior PRs overlap these files.");
    expect(briefMessages.viewBlast).toBe("View blast radius");
    expect(briefMessages.block).toEqual({
      intent: "Intent",
      blast: "Blast radius",
      risks: "Risks",
      history: "PR history",
    });
  });

  it("brief.why.* (git-why, a DIFFERENT feature) is completely untouched — no Why Timeline copy leaked into it", () => {
    expect(Object.keys(briefMessages.why).sort()).toEqual(["blame", "noCommits", "noHistory", "title"].sort());
    expect(briefMessages.why.title).toBe("git-why");
    expect(briefMessages.why.blame).toBe("blame");
    expect(briefMessages.why.noCommits).toBe("No commits found for this line.");
  });

  it("the new Why Timeline copy lives under brief.timeline.*, never brief.why.*", () => {
    expect(briefMessages).toHaveProperty("timeline");
    expect(briefMessages.timeline.title).toBe("Why Timeline");
    // Not a re-definition inside the reserved why.* namespace.
    expect((briefMessages.why as Record<string, unknown>)["timeline"]).toBeUndefined();
  });
});
