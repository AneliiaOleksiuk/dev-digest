/**
 * BlastPanel — tree/graph/banner coverage for the Overview Blast card.
 */
import type React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { BlastRadiusResponse } from "@devdigest/shared";
import blastMessages from "../../../../../../../../../../messages/en/blast.json";

const useBlastRadius = vi.fn();

vi.mock("@/lib/hooks/blast", () => ({
  useBlastRadius: (...args: unknown[]) => useBlastRadius(...args),
}));

import { BlastPanel } from "./BlastPanel";

afterEach(() => {
  cleanup();
  useBlastRadius.mockReset();
});

function renderPanel(props: Partial<React.ComponentProps<typeof BlastPanel>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ blast: blastMessages }}>
      <BlastPanel prId="pr-1" repoFullName="acme/widgets" headSha="abc1234" repoId="repo-1" {...props} />
    </NextIntlClientProvider>,
  );
}

const FULL_RESPONSE: BlastRadiusResponse = {
  changed_symbols: [
    { name: "doThing", file: "src/a.ts", kind: "function" },
    { name: "other", file: "src/b.ts", kind: "function" },
  ],
  downstream: [
    {
      symbol: "doThing",
      callers: [{ name: "handler", file: "src/routes/things.ts", line: 42 }],
      endpoints_affected: ["GET /things"],
      crons_affected: [],
    },
    {
      symbol: "other",
      callers: [{ name: "x", file: "src/x.ts", line: 1 }],
      endpoints_affected: [],
      crons_affected: [],
    },
  ],
  summary: "2 changed symbols…",
  status: "full",
  reason: null,
  prior_prs: [],
};

describe("BlastPanel", () => {
  it("renders changed symbols, callers, and endpoints from a full result, with no warning banner", () => {
    useBlastRadius.mockReturnValue({
      data: FULL_RESPONSE,
      isLoading: false,
      isError: false,
      isFetching: false,
    });
    renderPanel();

    expect(screen.getByText("doThing()")).toBeInTheDocument();
    expect(screen.getByText("src/routes/things.ts:42")).toBeInTheDocument();
    expect(screen.queryByText("handler")).not.toBeInTheDocument();
    expect(screen.getByText("GET /things")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    // Inline stats (not tile cards)
    expect(screen.getByLabelText("Blast radius stats")).toHaveTextContent("2");
    expect(screen.getByLabelText("Blast radius stats")).toHaveTextContent("symbols");
  });

  it("a caller's file:line links to the expected githubBlobUrl", () => {
    useBlastRadius.mockReturnValue({
      data: FULL_RESPONSE,
      isLoading: false,
      isError: false,
      isFetching: false,
    });
    renderPanel();

    const link = screen.getByText("src/routes/things.ts:42").closest("a");
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/acme/widgets/blob/abc1234/src/routes/things.ts#L42",
    );
  });

  it("renders plain (unlinked) text when repoFullName is null — no crash", () => {
    useBlastRadius.mockReturnValue({
      data: FULL_RESPONSE,
      isLoading: false,
      isError: false,
      isFetching: false,
    });
    renderPanel({ repoFullName: null });

    expect(screen.getByText("src/routes/things.ts:42").closest("a")).toBeNull();
  });

  it("collapses non-first symbol groups by default and expands on click", () => {
    useBlastRadius.mockReturnValue({
      data: FULL_RESPONSE,
      isLoading: false,
      isError: false,
      isFetching: false,
    });
    renderPanel();

    expect(screen.getByText("src/routes/things.ts:42")).toBeInTheDocument();
    expect(screen.queryByText("src/x.ts:1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /other\(\)/i }));
    expect(screen.getByText("src/x.ts:1")).toBeInTheDocument();
  });

  it("renders a warning banner with the server's reason for a degraded result", () => {
    useBlastRadius.mockReturnValue({
      data: {
        changed_symbols: [],
        downstream: [],
        summary: "Blast radius is unavailable.",
        status: "degraded",
        reason: "This repo has no usable code index yet.",
        prior_prs: [],
      },
      isLoading: false,
      isError: false,
      isFetching: false,
    });
    renderPanel();

    expect(screen.getByRole("status")).toHaveTextContent("This repo has no usable code index yet.");
  });

  it("renders a distinct warning banner for status: partial too (not treated as a normal full result)", () => {
    useBlastRadius.mockReturnValue({
      data: {
        ...FULL_RESPONSE,
        status: "partial",
        reason: "This repo's index is partial (10 of 20 files).",
      },
      isLoading: false,
      isError: false,
      isFetching: false,
    });
    renderPanel();

    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("This repo's index is partial (10 of 20 files).");
    expect(banner).toHaveTextContent("Partial index");
  });

  it("the Tree/Graph toggle switches views", () => {
    useBlastRadius.mockReturnValue({
      data: FULL_RESPONSE,
      isLoading: false,
      isError: false,
      isFetching: false,
    });
    renderPanel();

    expect(screen.getByText("src/routes/things.ts:42")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Blast radius graph" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "graph" }));

    expect(screen.getByRole("img", { name: "Blast radius graph" })).toBeInTheDocument();
    expect(screen.queryByText("src/routes/things.ts:42")).not.toBeInTheDocument();
  });

  it("prior_prs renders collapsed with a count and expands to internal PR links", () => {
    useBlastRadius.mockReturnValue({
      data: {
        ...FULL_RESPONSE,
        prior_prs: [
          { id: "pr-2", number: 80, title: "Add rate limiting", author: "bob", overlapping_files: 3 },
          { id: "pr-3", number: 50, title: "Refactor billing", author: "alice", overlapping_files: 1 },
        ],
      },
      isLoading: false,
      isError: false,
      isFetching: false,
    });
    renderPanel();

    const toggle = screen.getByRole("button", { name: /Prior PRs touching these files/i });
    expect(toggle).toHaveTextContent("2");
    expect(screen.queryByText("Add rate limiting")).not.toBeInTheDocument();

    fireEvent.click(toggle);

    const link = screen.getByText("Add rate limiting").closest("a");
    expect(link).toHaveAttribute("href", "/repos/repo-1/pulls/80");
  });

  it("renders nothing for the prior-PRs section when prior_prs is empty", () => {
    useBlastRadius.mockReturnValue({
      data: FULL_RESPONSE,
      isLoading: false,
      isError: false,
      isFetching: false,
    });
    renderPanel();

    expect(screen.queryByText("Prior PRs touching these files")).not.toBeInTheDocument();
  });

  it("does not fetch while enabled=false (PR detail not ready)", () => {
    useBlastRadius.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      isFetching: false,
    });
    renderPanel({ enabled: false });

    expect(useBlastRadius).toHaveBeenCalledWith("pr-1", { enabled: false });
  });
});
