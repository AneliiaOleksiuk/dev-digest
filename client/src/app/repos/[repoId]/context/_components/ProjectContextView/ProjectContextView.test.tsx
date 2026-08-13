/**
 * ProjectContextView — implementer's own self-check (minimal; test-writer
 * owns the full suite per WI9's stated Definition of done: AC-6 summary
 * text, AC-7 filter narrows the summary, AC-4 selection renders the
 * preview, E-14 zero state).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ContextListing } from "@devdigest/shared";
import contextMessages from "../../../../../../../messages/en/context.json";

const useContextDocuments = vi.fn();
const useContextDocument = vi.fn();
const useSaveContextDocument = vi.fn();
const useRepoIntelStatus = vi.fn();
const useResyncRepoIntel = vi.fn();

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "repo-1" }),
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { id: "repo-1", full_name: "acme/widgets" } }),
  useRepoNotFound: () => false,
}));
vi.mock("@/lib/hooks/context", () => ({
  useContextDocuments: (...args: unknown[]) => useContextDocuments(...args),
  useContextDocument: (...args: unknown[]) => useContextDocument(...args),
  useSaveContextDocument: (...args: unknown[]) => useSaveContextDocument(...args),
}));
vi.mock("@/lib/hooks/repo-intel", () => ({
  useRepoIntelStatus: (...args: unknown[]) => useRepoIntelStatus(...args),
  useResyncRepoIntel: (...args: unknown[]) => useResyncRepoIntel(...args),
}));

import { ProjectContextView } from "./ProjectContextView";

afterEach(() => {
  cleanup();
  useContextDocuments.mockReset();
  useContextDocument.mockReset();
  useSaveContextDocument.mockReset();
  useRepoIntelStatus.mockReset();
  useResyncRepoIntel.mockReset();
});

function renderView() {
  useSaveContextDocument.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  useRepoIntelStatus.mockReturnValue({ data: undefined });
  useResyncRepoIntel.mockReturnValue({ mutate: vi.fn(), isPending: false });
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: contextMessages }}>
      <ProjectContextView />
    </NextIntlClientProvider>,
  );
}

const LISTING: ContextListing = {
  documents: [
    { path: "docs/adr/0001-x.md", source_folder: "docs", type: "md", tokens: 40, bytes: 200, used_by_agents: 1, missing: false },
    { path: "specs/skills-feature.md", source_folder: "specs", type: "md", tokens: 60, bytes: 300, used_by_agents: 0, missing: false },
  ],
  total_tokens: 100,
  total_files: 2,
  degraded_reason: null,
  roots: ["specs", "docs", "insights"],
};

describe("ProjectContextView", () => {
  it("AC-6: header summary shows file count + token total, no chunk count", () => {
    useContextDocuments.mockReturnValue({ data: LISTING, isLoading: false, isError: false, refetch: vi.fn() });
    useContextDocument.mockReturnValue({ data: undefined, isLoading: false, isError: false });

    renderView();

    expect(screen.getByText("2 files indexed · ≈100 tokens")).toBeInTheDocument();
    expect(screen.queryByText(/chunk/i)).not.toBeInTheDocument();
  });

  it("AC-7: typing a filter narrows the summary to the matching subset", () => {
    useContextDocuments.mockReturnValue({ data: LISTING, isLoading: false, isError: false, refetch: vi.fn() });
    useContextDocument.mockReturnValue({ data: undefined, isLoading: false, isError: false });

    renderView();
    fireEvent.change(screen.getByPlaceholderText("Search documents…"), { target: { value: "adr" } });

    expect(screen.getByText("1 files indexed · ≈40 tokens")).toBeInTheDocument();
  });

  it("AC-4: selecting a document renders its content in the preview panel", () => {
    useContextDocuments.mockReturnValue({ data: LISTING, isLoading: false, isError: false, refetch: vi.fn() });
    useContextDocument.mockReturnValue({
      data: { path: "docs/adr/0001-x.md", content: "# ADR 0001\nHello." },
      isLoading: false,
      isError: false,
    });

    renderView();
    fireEvent.click(screen.getByText("docs/adr/0001-x.md"));

    expect(screen.getByText("Hello.")).toBeInTheDocument();
  });

  it("E-14: a clone with zero discovered documents renders the empty state", () => {
    useContextDocuments.mockReturnValue({
      data: { documents: [], total_tokens: 0, total_files: 0, degraded_reason: null },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    useContextDocument.mockReturnValue({ data: undefined, isLoading: false, isError: false });

    renderView();

    expect(screen.getByText("No documents found")).toBeInTheDocument();
  });

  // test-writer addition — WI9's own bullet list scopes E-2 in ("Three
  // empty/missing states … attached-but-missing document badge (E-2)") even
  // though it isn't spelled out in the DoD's four bullets; the implementer's
  // self-check never rendered a `missing: true` row.
  it("E-2: an attached-but-deleted-from-disk document renders a missing badge, not a silently dropped row", () => {
    useContextDocuments.mockReturnValue({
      data: {
        documents: [
          ...LISTING.documents,
          { path: "docs/gone.md", source_folder: "", type: "md", tokens: 0, bytes: 0, used_by_agents: 1, missing: true },
        ],
        total_tokens: 100,
        total_files: 3,
        degraded_reason: null,
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    useContextDocument.mockReturnValue({ data: undefined, isLoading: false, isError: false });

    renderView();

    // The missing document still renders as a row (never silently dropped)…
    expect(screen.getByText("docs/gone.md")).toBeInTheDocument();
    // …with a "missing from disk" badge distinguishing it from a normal row.
    expect(screen.getByText("Missing from disk")).toBeInTheDocument();
  });

  // test-writer addition — AC-29/AC-31/AC-32 (SPEC-01 amendment, WI7): the
  // coverage indicator, computed over the SAME filtered array as the AC-6/
  // AC-7 summary (UX-17), rendered via CircularScore's plain numeric score.
  // Oracle: AC-29 ("4 present, 3 used → 75%"), AC-31 (recomputes with the
  // filter), AC-32 (zero eligible documents → no percentage, never 0/NaN).
  it("AC-29: coverage renders as a percentage of listed (non-missing) documents with used_by_agents > 0", () => {
    const listing = {
      documents: [
        { path: "a.md", source_folder: "docs", type: "md", tokens: 10, bytes: 40, used_by_agents: 1, missing: false },
        { path: "b.md", source_folder: "docs", type: "md", tokens: 10, bytes: 40, used_by_agents: 2, missing: false },
        { path: "c.md", source_folder: "docs", type: "md", tokens: 10, bytes: 40, used_by_agents: 0, missing: false },
        { path: "d.md", source_folder: "docs", type: "md", tokens: 10, bytes: 40, used_by_agents: 5, missing: false },
        { path: "gone.md", source_folder: "", type: "md", tokens: 0, bytes: 0, used_by_agents: 1, missing: true },
      ],
      total_tokens: 40,
      total_files: 5,
      degraded_reason: null,
      roots: ["specs", "docs", "insights"],
    };
    useContextDocuments.mockReturnValue({ data: listing, isLoading: false, isError: false, refetch: vi.fn() });
    useContextDocument.mockReturnValue({ data: undefined, isLoading: false, isError: false });

    renderView();

    expect(screen.getByText("75")).toBeInTheDocument();
    expect(screen.getByText("3 of 4 documents attached to at least one agent")).toBeInTheDocument();
  });

  it("AC-31: typing a filter recomputes the coverage indicator together with the summary, over the SAME filtered subset", () => {
    useContextDocuments.mockReturnValue({ data: LISTING, isLoading: false, isError: false, refetch: vi.fn() });
    useContextDocument.mockReturnValue({ data: undefined, isLoading: false, isError: false });

    renderView();
    // Before filtering: LISTING has 2 docs, 1 with used_by_agents > 0 → 50%.
    expect(screen.getByText("50")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search documents…"), { target: { value: "adr" } });

    // After filtering to just the "adr" doc (used_by_agents: 1) → 100%.
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("1 of 1 documents attached to at least one agent")).toBeInTheDocument();
    expect(screen.queryByText("50")).not.toBeInTheDocument();
  });

  it("AC-32/E-24: a listing of ONLY missing:true documents renders no coverage percentage (not 100%, not an error)", () => {
    const listing = {
      documents: [
        { path: "gone-1.md", source_folder: "", type: "md", tokens: 0, bytes: 0, used_by_agents: 1, missing: true },
        { path: "gone-2.md", source_folder: "", type: "md", tokens: 0, bytes: 0, used_by_agents: 3, missing: true },
      ],
      total_tokens: 0,
      total_files: 2,
      degraded_reason: null,
      roots: ["specs", "docs", "insights"],
    };
    useContextDocuments.mockReturnValue({ data: listing, isLoading: false, isError: false, refetch: vi.fn() });
    useContextDocument.mockReturnValue({ data: undefined, isLoading: false, isError: false });

    renderView();

    expect(screen.queryByText(/documents attached to at least one agent/)).not.toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("AC-32/E-14: the zero-documents empty state renders no coverage indicator either", () => {
    useContextDocuments.mockReturnValue({
      data: { documents: [], total_tokens: 0, total_files: 0, degraded_reason: null, roots: ["specs", "docs", "insights"] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    useContextDocument.mockReturnValue({ data: undefined, isLoading: false, isError: false });

    renderView();

    expect(screen.queryByText(/documents attached to at least one agent/)).not.toBeInTheDocument();
  });
});
