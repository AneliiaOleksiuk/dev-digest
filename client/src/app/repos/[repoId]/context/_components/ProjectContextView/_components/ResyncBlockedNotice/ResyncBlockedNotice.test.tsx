/**
 * ResyncBlockedNotice — AC-52 (SPEC-01 amendment, WI10). Oracle derived
 * from the Spec/Plan before this component was opened for wiring facts:
 *   - AC-52: a blocked resync (`reason` starting `dirty_clone:`) reads as
 *     an INSTRUCTION (commit or discard, in the user's own git tooling),
 *     names the affected paths (bounded), and offers only "Check again"
 *     (re-attempt) — never a commit/discard action (Non-goals).
 *   - The refusal must be visually/textually distinct from a generic
 *     network/fetch failure — a `sync_failed:` or absent reason renders
 *     NOTHING from this component (some other surface owns that case).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import contextMessages from "../../../../../../../../../messages/en/context.json";

const useRepoIntelStatus = vi.fn();
const useResyncRepoIntel = vi.fn();

vi.mock("@/lib/hooks/repo-intel", () => ({
  useRepoIntelStatus: (...args: unknown[]) => useRepoIntelStatus(...args),
  useResyncRepoIntel: (...args: unknown[]) => useResyncRepoIntel(...args),
}));

import { ResyncBlockedNotice } from "./ResyncBlockedNotice";

afterEach(() => {
  cleanup();
  useRepoIntelStatus.mockReset();
  useResyncRepoIntel.mockReset();
});

function renderNotice() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: contextMessages }}>
      <ResyncBlockedNotice repoId="repo-1" />
    </NextIntlClientProvider>,
  );
}

describe("ResyncBlockedNotice", () => {
  it("AC-52: a dirty_clone reason renders an instruction (commit/discard), never a failure message", () => {
    useRepoIntelStatus.mockReturnValue({ data: { reason: "dirty_clone:docs/edited.md, docs/created.md" } });
    useResyncRepoIntel.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderNotice();

    expect(screen.getByText("Re-analyze is paused")).toBeInTheDocument();
    expect(
      screen.getByText(
        "This repo's clone has uncommitted changes — commit or discard them using your own git tooling, then check again. DevDigest does not commit, discard, or push anything on your behalf.",
      ),
    ).toBeInTheDocument();
  });

  it("AC-52: names the affected paths parsed out of the reason string", () => {
    useRepoIntelStatus.mockReturnValue({ data: { reason: "dirty_clone:docs/edited.md, docs/created.md" } });
    useResyncRepoIntel.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderNotice();

    expect(screen.getByText("docs/edited.md")).toBeInTheDocument();
    expect(screen.getByText("docs/created.md")).toBeInTheDocument();
  });

  it('offers only "Check again" (re-attempt) — no commit/discard action exists (Non-goals)', () => {
    useRepoIntelStatus.mockReturnValue({ data: { reason: "dirty_clone:docs/edited.md" } });
    const mutate = vi.fn();
    useResyncRepoIntel.mockReturnValue({ mutate, isPending: false });

    renderNotice();

    expect(screen.queryByText(/commit/i, { selector: "button" })).not.toBeInTheDocument();
    expect(screen.queryByText(/discard/i, { selector: "button" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Check again"));
    expect(mutate).toHaveBeenCalled();
  });

  it("renders nothing when there is no reason at all (nothing to report)", () => {
    useRepoIntelStatus.mockReturnValue({ data: undefined });
    useResyncRepoIntel.mockReturnValue({ mutate: vi.fn(), isPending: false });

    const { container } = renderNotice();

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a sync_failed: reason — a network/fetch failure is NOT this component's case", () => {
    useRepoIntelStatus.mockReturnValue({ data: { reason: "sync_failed:ECONNREFUSED" } });
    useResyncRepoIntel.mockReturnValue({ mutate: vi.fn(), isPending: false });

    const { container } = renderNotice();

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText("Re-analyze is paused")).not.toBeInTheDocument();
  });

  it("renders nothing for a no_clone reason (unrelated degraded state)", () => {
    useRepoIntelStatus.mockReturnValue({ data: { reason: "no_clone" } });
    useResyncRepoIntel.mockReturnValue({ mutate: vi.fn(), isPending: false });

    const { container } = renderNotice();

    expect(container).toBeEmptyDOMElement();
  });
});
