/**
 * NewDocumentDialog — manual document creation (WI9). Oracle derived from
 * the Spec/Plan before this component was opened for wiring facts:
 *   - AC-41: submitting calls the create mutation with a repo-relative path
 *     under the chosen root and the typed content.
 *   - AC-42 (client half): a successful create invalidates/refreshes via
 *     `onCreated`, closing the dialog.
 *   - UX-16 / AC-47 (client half): the UI appends `.md` and builds the path
 *     from root + relative segment — the user never types an extension.
 *   - E-14/Rec-4: with zero configured roots (`roots: []`), the dialog
 *     cannot be submitted and explains why, rather than submitting a
 *     malformed path.
 *   - NFR A04: the outbound-data notice is visible on this authoring
 *     surface too, not only the read-only attach surfaces.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import contextMessages from "../../../../../../../../../messages/en/context.json";

const useCreateContextDocument = vi.fn();

vi.mock("@/lib/hooks/context", () => ({
  useCreateContextDocument: (...args: unknown[]) => useCreateContextDocument(...args),
}));

import { NewDocumentDialog } from "./NewDocumentDialog";

afterEach(() => {
  cleanup();
  useCreateContextDocument.mockReset();
});

function renderDialog(props: { roots: string[]; onClose?: () => void; onCreated?: (path: string) => void }) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: contextMessages }}>
      <NewDocumentDialog
        repoId="repo-1"
        roots={props.roots}
        onClose={props.onClose ?? vi.fn()}
        onCreated={props.onCreated ?? vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

describe("NewDocumentDialog", () => {
  it("AC-41/UX-16: submitting builds path as <root>/<relative>.md and sends the typed content", async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ document: { path: "docs/api-rules.md" } });
    useCreateContextDocument.mockReturnValue({ mutateAsync, isPending: false });
    const onCreated = vi.fn();
    const onClose = vi.fn();

    renderDialog({ roots: ["specs", "docs", "insights"], onCreated, onClose });

    fireEvent.change(screen.getByPlaceholderText("adr/0005-example"), {
      target: { value: "api-rules" },
    });
    // Two textboxes exist (the relative-path TextInput and the content
    // Textarea, neither labelled via `htmlFor`) — the content field is the
    // second one, a plain <textarea>.
    const contentField = screen.getAllByRole("textbox").find((el) => el.tagName === "TEXTAREA")!;
    fireEvent.change(contentField, { target: { value: "the api module must not import db directly" } });

    fireEvent.click(screen.getByText("Create"));

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        path: "specs/api-rules.md",
        content: "the api module must not import db directly",
      }),
    );
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("docs/api-rules.md"));
    expect(onClose).toHaveBeenCalled();
  });

  it("UX-16: does not double-append .md when the user already typed the extension", async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ document: { path: "docs/x.md" } });
    useCreateContextDocument.mockReturnValue({ mutateAsync, isPending: false });

    renderDialog({ roots: ["docs"] });

    fireEvent.change(screen.getByPlaceholderText("adr/0005-example"), {
      target: { value: "already-has-ext.md" },
    });
    fireEvent.click(screen.getByText("Create"));

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({ path: "docs/already-has-ext.md", content: "" }),
    );
  });

  it("E-14/Rec-4: with zero configured roots, the dialog explains why and Create is disabled", () => {
    useCreateContextDocument.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });

    renderDialog({ roots: [] });

    expect(screen.getByText("No configured search roots are available for this repo.")).toBeInTheDocument();
    expect(screen.getByText("Create")).toBeDisabled();
  });

  it("Create stays disabled until a non-empty relative path is entered", () => {
    useCreateContextDocument.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });

    renderDialog({ roots: ["docs"] });

    expect(screen.getByText("Create")).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("adr/0005-example"), { target: { value: "  " } });
    expect(screen.getByText("Create")).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("adr/0005-example"), { target: { value: "real-name" } });
    expect(screen.getByText("Create")).not.toBeDisabled();
  });

  it("NFR A04: the outbound-data notice is visible on the authoring surface", () => {
    useCreateContextDocument.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });

    renderDialog({ roots: ["docs"] });

    expect(
      screen.getByText(
        "Attached documents are sent to the model provider on every run of every agent that inherits them.",
      ),
    ).toBeInTheDocument();
  });

  it("a failed create surfaces an inline error and does NOT close the dialog", async () => {
    const mutateAsync = vi.fn().mockRejectedValue(new Error("boom"));
    useCreateContextDocument.mockReturnValue({ mutateAsync, isPending: false });
    const onClose = vi.fn();

    renderDialog({ roots: ["docs"], onClose });

    fireEvent.change(screen.getByPlaceholderText("adr/0005-example"), { target: { value: "will-fail" } });
    fireEvent.click(screen.getByText("Create"));

    expect(await screen.findByText("Couldn’t create this document.")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
