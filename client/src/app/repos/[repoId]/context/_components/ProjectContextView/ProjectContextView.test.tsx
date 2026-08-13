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
});
