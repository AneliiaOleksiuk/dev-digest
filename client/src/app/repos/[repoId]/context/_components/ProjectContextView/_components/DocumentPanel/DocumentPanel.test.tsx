/**
 * DocumentPanel — Preview/Edit toggle + Save (WI8). Oracle derived from the
 * Spec/Plan before this component was opened for wiring facts:
 *   - AC-33: entering Edit populates the editor from a FRESH read
 *     (`refetch()`), never the cached `useContextDocument` body.
 *   - AC-34 (client half): Save calls the mutation with the current draft
 *     and the loaded document's `revision`.
 *   - AC-37 vs AC-39: a 409 (stale/conflict) renders a DISTINCT message from
 *     a generic write failure — never the same banner.
 *   - AC-40: a successful save returns the panel to Preview mode.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import contextMessages from "../../../../../../../../../messages/en/context.json";
import { ApiError } from "@/lib/api";

const useContextDocument = vi.fn();
const useSaveContextDocument = vi.fn();

vi.mock("@/lib/hooks/context", () => ({
  useContextDocument: (...args: unknown[]) => useContextDocument(...args),
  useSaveContextDocument: (...args: unknown[]) => useSaveContextDocument(...args),
}));

import { DocumentPanel } from "./DocumentPanel";

afterEach(() => {
  cleanup();
  useContextDocument.mockReset();
  useSaveContextDocument.mockReset();
});

function renderPanel(path = "docs/a.md") {
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: contextMessages }}>
      <DocumentPanel repoId="repo-1" path={path} />
    </NextIntlClientProvider>,
  );
}

describe("DocumentPanel", () => {
  it("AC-33: entering Edit populates the editor from a FRESH refetch, never the cached body", async () => {
    const refetch = vi.fn().mockResolvedValue({
      data: { path: "docs/a.md", content: "fresh from disk", revision: "rev-2" },
    });
    useContextDocument.mockReturnValue({
      data: { path: "docs/a.md", content: "stale cached body", revision: "rev-1" },
      isLoading: false,
      isError: false,
      refetch,
    });
    useSaveContextDocument.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });

    renderPanel();
    fireEvent.click(screen.getByText("Edit"));

    await waitFor(() => expect(refetch).toHaveBeenCalled());
    const textarea = await screen.findByRole("textbox");
    await waitFor(() => expect(textarea).toHaveValue("fresh from disk"));
    expect(textarea).not.toHaveValue("stale cached body");
  });

  it("AC-34: Save calls the mutation with the draft content and the loaded document's revision", async () => {
    const refetch = vi.fn().mockResolvedValue({
      data: { path: "docs/a.md", content: "original", revision: "rev-1" },
    });
    useContextDocument.mockReturnValue({
      data: { path: "docs/a.md", content: "original", revision: "rev-1" },
      isLoading: false,
      isError: false,
      refetch,
    });
    const mutateAsync = vi.fn().mockResolvedValue({});
    useSaveContextDocument.mockReturnValue({ mutateAsync, isPending: false });

    renderPanel();
    fireEvent.click(screen.getByText("Edit"));
    const textarea = await screen.findByRole("textbox");
    fireEvent.change(textarea, { target: { value: "edited body" } });

    fireEvent.click(screen.getByText("Save"));

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        path: "docs/a.md",
        content: "edited body",
        revision: "rev-1",
      }),
    );
  });

  it("AC-40: a successful save returns the panel to Preview mode", async () => {
    useContextDocument.mockReturnValue({
      data: { path: "docs/a.md", content: "original", revision: "rev-1" },
      isLoading: false,
      isError: false,
      refetch: vi.fn().mockResolvedValue({ data: { path: "docs/a.md", content: "original", revision: "rev-1" } }),
    });
    useSaveContextDocument.mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false });

    renderPanel();
    fireEvent.click(screen.getByText("Edit"));
    const textarea = await screen.findByRole("textbox");
    fireEvent.change(textarea, { target: { value: "edited body" } });
    fireEvent.click(screen.getByText("Save"));

    // Back in Preview mode — the "Edit" toggle button is visible again.
    await waitFor(() => expect(screen.getByText("Edit")).toBeInTheDocument());
  });

  it("AC-37: a 409 conflict renders a distinct 'reload and try again' message, not the generic save-error message", async () => {
    useContextDocument.mockReturnValue({
      data: { path: "docs/a.md", content: "original", revision: "rev-1" },
      isLoading: false,
      isError: false,
      refetch: vi.fn().mockResolvedValue({ data: { path: "docs/a.md", content: "original", revision: "rev-1" } }),
    });
    const conflictError = new ApiError("Conflict", 409, "conflict");
    useSaveContextDocument.mockReturnValue({ mutateAsync: vi.fn().mockRejectedValue(conflictError), isPending: false });

    renderPanel();
    fireEvent.click(screen.getByText("Edit"));
    const textarea = await screen.findByRole("textbox");
    fireEvent.change(textarea, { target: { value: "edited body" } });
    fireEvent.click(screen.getByText("Save"));

    expect(
      await screen.findByText("This document changed on disk since you opened it. Reload and try again."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Couldn’t save this document.")).not.toBeInTheDocument();
  });

  it("AC-39: a non-409 write failure renders the GENERIC save-error message, not the conflict message", async () => {
    useContextDocument.mockReturnValue({
      data: { path: "docs/a.md", content: "original", revision: "rev-1" },
      isLoading: false,
      isError: false,
      refetch: vi.fn().mockResolvedValue({ data: { path: "docs/a.md", content: "original", revision: "rev-1" } }),
    });
    const permissionError = new ApiError("Write failed", 500, "internal_error");
    useSaveContextDocument.mockReturnValue({ mutateAsync: vi.fn().mockRejectedValue(permissionError), isPending: false });

    renderPanel();
    fireEvent.click(screen.getByText("Edit"));
    const textarea = await screen.findByRole("textbox");
    fireEvent.change(textarea, { target: { value: "edited body" } });
    fireEvent.click(screen.getByText("Save"));

    expect(await screen.findByText("Couldn’t save this document.")).toBeInTheDocument();
    expect(
      screen.queryByText("This document changed on disk since you opened it. Reload and try again."),
    ).not.toBeInTheDocument();
  });

  it("selecting a different document (path change) resets edit mode back to Preview", async () => {
    useContextDocument.mockReturnValue({
      data: { path: "docs/a.md", content: "a body", revision: "rev-1" },
      isLoading: false,
      isError: false,
      refetch: vi.fn().mockResolvedValue({ data: { path: "docs/a.md", content: "a body", revision: "rev-1" } }),
    });
    useSaveContextDocument.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });

    const { rerender } = renderPanel("docs/a.md");
    fireEvent.click(screen.getByText("Edit"));
    await screen.findByRole("textbox");

    useContextDocument.mockReturnValue({
      data: { path: "docs/b.md", content: "b body", revision: "rev-9" },
      isLoading: false,
      isError: false,
      refetch: vi.fn().mockResolvedValue({ data: { path: "docs/b.md", content: "b body", revision: "rev-9" } }),
    });
    rerender(
      <NextIntlClientProvider locale="en" messages={{ context: contextMessages }}>
        <DocumentPanel repoId="repo-1" path="docs/b.md" />
      </NextIntlClientProvider>,
    );

    // Back to Preview mode for the newly selected document.
    expect(screen.getByText("Edit")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
