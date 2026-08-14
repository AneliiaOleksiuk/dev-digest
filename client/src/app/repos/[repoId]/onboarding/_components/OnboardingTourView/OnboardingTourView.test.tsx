/**
 * OnboardingTourView — the AC-6 end-to-end confirm gate, plus FIX-7's W11
 * gaps (AC-22 per-degraded-status rendering, AC-29's `cost_usd: null` case).
 *
 * Oracle (derived BEFORE reading OnboardingTourView.tsx):
 *   - AC-6's own verify method is explicit — "component test — the call is
 *     not requested until the confirmation is accepted". `RegenerateConfirmModal.test.tsx`
 *     covers the modal's own isolated contract (names both consequences,
 *     calls onConfirm only on click); THIS file proves the wiring around it:
 *     clicking Regenerate/Generate must NOT call the generate mutation
 *     immediately — only after the modal's confirm button is clicked.
 *   - FIX-6 (fix plan for the prior plan-verifier Phase 1 FAIL): the Spec's
 *     Non-goals state generation happens "only on an explicit, confirmed
 *     user action, because it costs money" (not scoped to Regenerate only) —
 *     so a FIRST-EVER generation must ALSO be gated behind the confirm modal,
 *     showing the "generate" mode copy, not the "regenerate" copy.
 *   - AC-22: "The deterministic skeleton shall contain only facts that need
 *     no model ... It shall not present empty section bodies as if
 *     generation had succeeded" — verified per degraded status via the
 *     status badge + `tour.reason` text rendering distinctly.
 *   - AC-29/E-16: "the page shall surface that generation cost ... including
 *     the `costUsd: null` case rendering no fabricated number".
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import onboardingMessages from "../../../../../../../messages/en/onboarding.json";

const useOnboardingTour = vi.fn();
const useGenerateOnboardingTour = vi.fn();
const useResyncRepoIntel = vi.fn();

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "repo-1" }),
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { id: "repo-1", full_name: "acme/widgets", default_branch: "main" } }),
  useRepoNotFound: () => false,
}));
vi.mock("@/lib/hooks/onboarding", () => ({
  useOnboardingTour: (...args: unknown[]) => useOnboardingTour(...args),
  useGenerateOnboardingTour: (...args: unknown[]) => useGenerateOnboardingTour(...args),
}));
vi.mock("@/lib/hooks/repo-intel", () => ({
  useResyncRepoIntel: (...args: unknown[]) => useResyncRepoIntel(...args),
}));

import { OnboardingTourView } from "./OnboardingTourView";

afterEach(() => {
  cleanup();
  useOnboardingTour.mockReset();
  useGenerateOnboardingTour.mockReset();
  useResyncRepoIntel.mockReset();
});

const STORED_TOUR = {
  sections: [
    { kind: "architecture", title: "Architecture", body: "prose", diagram: null, links: [] },
    { kind: "critical_paths", title: "Critical paths", body: "prose", diagram: null, links: [] },
    { kind: "run_locally", title: "Run locally", body: "prose", diagram: null, links: [] },
    { kind: "reading_path", title: "Reading path", body: "prose", diagram: null, links: [] },
    { kind: "first_tasks", title: "First tasks", body: "prose", diagram: null, links: [] },
  ],
  status: "ok",
  generated_at: "2026-08-01T00:00:00.000Z",
  files_indexed: 12,
  index_status: "full",
  index_sha: "sha-1",
  stale: false,
  usage: { provider: "openrouter", model: "deepseek/deepseek-v4-flash", call_count: 1, tokens_in: 10, tokens_out: 5, cost_usd: 0.001 },
  reason: "Generated from a full index of 12 files.",
};

function renderView() {
  useResyncRepoIntel.mockReturnValue({ mutate: vi.fn(), isPending: false });
  return render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: onboardingMessages }}>
      <OnboardingTourView />
    </NextIntlClientProvider>,
  );
}

describe("OnboardingTourView — AC-6 Regenerate confirm gate", () => {
  it("clicking Regenerate on a repo with a STORED tour opens the confirmation and does NOT call mutate() yet", () => {
    const mutate = vi.fn();
    useOnboardingTour.mockReturnValue({ data: STORED_TOUR, isLoading: false, isError: false, error: null, refetch: vi.fn() });
    useGenerateOnboardingTour.mockReturnValue({ mutate, isPending: false });

    renderView();
    fireEvent.click(screen.getByText("Regenerate"));

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText("Regenerate the onboarding tour?")).toBeInTheDocument();
  });

  it("only after the confirm modal is accepted does mutate() get called — exactly once", () => {
    const mutate = vi.fn();
    useOnboardingTour.mockReturnValue({ data: STORED_TOUR, isLoading: false, isError: false, error: null, refetch: vi.fn() });
    useGenerateOnboardingTour.mockReturnValue({ mutate, isPending: false });

    renderView();
    fireEvent.click(screen.getByText("Regenerate"));
    expect(mutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Regenerate now"));
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------- FIX-6
  it("FIX-6 (corrects the old, now-wrong expectation): a FIRST-EVER generation (no stored tour yet) is ALSO gated behind confirmation — Generate does NOT call mutate() until confirmed, and shows the 'generate' mode copy", () => {
    const mutate = vi.fn();
    useOnboardingTour.mockReturnValue({
      data: { ...STORED_TOUR, status: "never_generated", generated_at: null, sections: [] },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    useGenerateOnboardingTour.mockReturnValue({ mutate, isPending: false });

    renderView();
    fireEvent.click(screen.getByText("Generate onboarding tour"));

    // NOT called yet — the click only opens the modal (this is the exact
    // regression FIX-6 exists to fix: the OLD code called mutate() directly
    // here with no confirmation at all).
    expect(mutate).not.toHaveBeenCalled();
    // The "generate" mode copy shows, NOT the "regenerate" copy — there is no
    // existing tour to "replace" on a first-ever generation.
    expect(screen.getByText("Generate the onboarding tour?")).toBeInTheDocument();
    expect(screen.queryByText("Regenerate the onboarding tour?")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Generate now"));
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("FIX-6: Regenerate (stored tour exists) still shows the 'regenerate' mode copy — the mode-prop split did not silently drop it", () => {
    const mutate = vi.fn();
    useOnboardingTour.mockReturnValue({ data: STORED_TOUR, isLoading: false, isError: false, error: null, refetch: vi.fn() });
    useGenerateOnboardingTour.mockReturnValue({ mutate, isPending: false });

    renderView();
    fireEvent.click(screen.getByText("Regenerate"));

    expect(screen.getByText("Regenerate the onboarding tour?")).toBeInTheDocument();
    expect(screen.queryByText("Generate the onboarding tour?")).not.toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Regenerate now"));
    expect(mutate).toHaveBeenCalledTimes(1);
  });
});

// -------------------------------------------------------------------- AC-22
describe("OnboardingTourView — AC-22 per-degraded-status skeleton rendering", () => {
  const cases: { status: string; badgeLabel: string; reason: string }[] = [
    { status: "no_clone", badgeLabel: "No clone", reason: "This repo has no local clone yet." },
    { status: "not_indexed", badgeLabel: "Not indexed", reason: "This repo has not been indexed yet." },
    { status: "partial_index", badgeLabel: "Partial index", reason: "Generated from a partial index of 12 files." },
    { status: "llm_failed", badgeLabel: "Generation failed", reason: "The last generation attempt failed." },
  ];

  for (const { status, badgeLabel, reason } of cases) {
    it(`status "${status}" renders its OWN badge label and tour.reason text directly — never a claim of success`, () => {
      useOnboardingTour.mockReturnValue({
        data: { ...STORED_TOUR, status, reason },
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });
      useGenerateOnboardingTour.mockReturnValue({ mutate: vi.fn(), isPending: false });

      renderView();

      expect(screen.getByText(badgeLabel)).toBeInTheDocument();
      expect(screen.getByText(reason)).toBeInTheDocument();
    });
  }

  // ------------------------------------------------------------------ FIX-4
  it('FIX-4: repo_too_large reads DISTINCTLY from a generic "not indexed yet" — same enum value, different tour.reason text (AC-16)', () => {
    const notIndexedGeneric = {
      ...STORED_TOUR,
      status: "not_indexed",
      reason: "This repo has not been indexed yet — the tour is built from a bounded, deterministic file sample instead of the import graph.",
    };
    useOnboardingTour.mockReturnValue({ data: notIndexedGeneric, isLoading: false, isError: false, error: null, refetch: vi.fn() });
    useGenerateOnboardingTour.mockReturnValue({ mutate: vi.fn(), isPending: false });
    renderView();
    expect(screen.getByText(notIndexedGeneric.reason)).toBeInTheDocument();
    cleanup();

    const repoTooLarge = {
      ...STORED_TOUR,
      status: "not_indexed",
      reason: "This repo is too large to index — the tour is built from a bounded, deterministic file sample instead of the import graph.",
    };
    useOnboardingTour.mockReturnValue({ data: repoTooLarge, isLoading: false, isError: false, error: null, refetch: vi.fn() });
    renderView();
    expect(screen.getByText(repoTooLarge.reason)).toBeInTheDocument();
    // Both share the SAME status badge label ("Not indexed") but the reason
    // sentences differ — the distinction lives in `reason`, not the enum.
    expect(repoTooLarge.reason).not.toBe(notIndexedGeneric.reason);
  });

  it("FIX-4: the status/reason row renders tour.reason DIRECTLY, never a value derived from sections.length — an empty-sections skeleton and a full 5-section tour with the SAME status/reason render the SAME text", () => {
    const emptySections = { ...STORED_TOUR, status: "partial_index", reason: "Generated from a partial index of 3 files.", sections: [] };
    useOnboardingTour.mockReturnValue({ data: emptySections, isLoading: false, isError: false, error: null, refetch: vi.fn() });
    useGenerateOnboardingTour.mockReturnValue({ mutate: vi.fn(), isPending: false });
    renderView();
    // With zero sections, `tour.reason` renders TWICE: once in the status
    // row, once as the empty-state body — both must carry the SAME text.
    expect(screen.getAllByText("Generated from a partial index of 3 files.")).toHaveLength(2);
    cleanup();

    const fullSections = { ...STORED_TOUR, status: "partial_index", reason: "Generated from a partial index of 3 files." };
    useOnboardingTour.mockReturnValue({ data: fullSections, isLoading: false, isError: false, error: null, refetch: vi.fn() });
    renderView();
    expect(screen.getByText("Generated from a partial index of 3 files.")).toBeInTheDocument();
  });

  it('status "ok" renders NO status/reason row at all — that row exists only for a status the user needs to be told about', () => {
    useOnboardingTour.mockReturnValue({ data: STORED_TOUR, isLoading: false, isError: false, error: null, refetch: vi.fn() });
    useGenerateOnboardingTour.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderView();

    expect(screen.queryByText("Full index")).not.toBeInTheDocument();
  });
});

// -------------------------------------------------------------------- AC-29
describe("OnboardingTourView — AC-29/E-16 cost rendering", () => {
  it("cost_usd: null renders NO fabricated number — the cost line shows the em-dash formatter output, never 0 or NaN", () => {
    useOnboardingTour.mockReturnValue({
      data: { ...STORED_TOUR, usage: { ...STORED_TOUR.usage, cost_usd: null } },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    useGenerateOnboardingTour.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderView();

    // The cost figure is rendered inline inside a longer "N calls · tokens ·
    // Cost: X" string, so match on the substring rather than exact text.
    expect(screen.getByText(/Cost: —/)).toBeInTheDocument();
    expect(screen.queryByText(/Cost: 0(?!\.)/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Cost: NaN/)).not.toBeInTheDocument();
  });

  it("usage present with a real cost_usd renders the call count and cost figure, not the noUsage fallback", () => {
    useOnboardingTour.mockReturnValue({ data: STORED_TOUR, isLoading: false, isError: false, error: null, refetch: vi.fn() });
    useGenerateOnboardingTour.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderView();

    expect(screen.getByText(/1 model call/)).toBeInTheDocument();
    expect(screen.queryByText("No cost data yet")).not.toBeInTheDocument();
  });

  it("usage null (never generated) renders the noUsage fallback, not a fabricated call count", () => {
    useOnboardingTour.mockReturnValue({
      data: { ...STORED_TOUR, status: "never_generated", generated_at: STORED_TOUR.generated_at, usage: null },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    useGenerateOnboardingTour.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderView();

    expect(screen.getByText("No cost data yet")).toBeInTheDocument();
  });
});
