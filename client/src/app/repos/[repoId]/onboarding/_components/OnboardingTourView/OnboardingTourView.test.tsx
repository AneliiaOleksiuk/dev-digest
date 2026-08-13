/**
 * OnboardingTourView — the AC-6 end-to-end confirm gate.
 *
 * Oracle (derived BEFORE reading OnboardingTourView.tsx): AC-6's own verify
 * method is explicit — "component test — the call is not requested until the
 * confirmation is accepted". `RegenerateConfirmModal.test.tsx` covers the
 * modal's own isolated contract (names both consequences, calls onConfirm
 * only on click); THIS file proves the wiring around it: clicking Regenerate
 * on a repo that already has a stored tour must NOT call the generate
 * mutation immediately — only after the modal's confirm button is clicked.
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

  it("a FIRST-EVER generation (no stored tour yet) skips the confirm gate — Generate calls mutate() directly (no prior tour to overwrite)", () => {
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

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Regenerate the onboarding tour?")).not.toBeInTheDocument();
  });
});
