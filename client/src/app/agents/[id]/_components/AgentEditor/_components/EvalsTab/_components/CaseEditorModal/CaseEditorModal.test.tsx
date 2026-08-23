/**
 * CaseEditorModal — the eval case editor's JSON-validity badge (L06 AC-10).
 *
 * Oracle (derived from specs/eval-pipeline.md AC-10 BEFORE reading
 * CaseEditorModal.tsx): "expected_output shall be validated against its
 * contract on save and the editor shall show validity before saving — the
 * caseEditor.validJson / invalidJson copy already authored." The critical
 * distinction this test exists for: validity is checked against the
 * `EvalExpectation` CONTRACT, not merely `JSON.parse` succeeding — a
 * syntactically valid JSON object that doesn't match the schema (wrong
 * `version`, missing fields) must still flip the badge to invalid and
 * disable Save.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import evalMessages from "../../../../../../../../../../messages/en/eval.json";

const useCreateEvalCase = vi.fn();
const useUpdateEvalCase = vi.fn();
const useRunEvalCase = vi.fn();

vi.mock("@/lib/hooks/eval", () => ({
  useCreateEvalCase: (...args: unknown[]) => useCreateEvalCase(...args),
  useUpdateEvalCase: (...args: unknown[]) => useUpdateEvalCase(...args),
  useRunEvalCase: (...args: unknown[]) => useRunEvalCase(...args),
}));

import { CaseEditorModal } from "./CaseEditorModal";

afterEach(() => {
  cleanup();
  useCreateEvalCase.mockReset();
  useUpdateEvalCase.mockReset();
  useRunEvalCase.mockReset();
});

function renderModal() {
  useCreateEvalCase.mockReturnValue({ mutate: vi.fn(), isPending: false });
  useUpdateEvalCase.mockReturnValue({ mutate: vi.fn(), isPending: false });
  useRunEvalCase.mockReturnValue({ mutate: vi.fn(), isPending: false });
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <CaseEditorModal agentId="ag1" onClose={vi.fn()} />
    </NextIntlClientProvider>,
  );
}

function expectedOutputField(): HTMLTextAreaElement {
  const textareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
  const field = textareas.find((el) => el.value.includes("must_find"));
  if (!field) throw new Error("expected_output textarea not found");
  return field;
}

describe("CaseEditorModal — AC-10 JSON-validity badge reflects EvalExpectation schema validity", () => {
  it("the default new-case payload is valid — badge shows 'valid JSON' and Save is enabled", () => {
    renderModal();
    expect(screen.getByText("valid JSON")).toBeInTheDocument();
    expect(screen.getByText("Save").closest("button")).not.toBeDisabled();
  });

  it("syntactically-invalid JSON flips the badge to 'invalid JSON' and disables Save", () => {
    renderModal();
    fireEvent.change(expectedOutputField(), { target: { value: "not json at all" } });

    expect(screen.getByText("invalid JSON")).toBeInTheDocument();
    expect(screen.queryByText("valid JSON")).not.toBeInTheDocument();
    expect(screen.getByText("Save").closest("button")).toBeDisabled();
  });

  it("syntactically-VALID JSON that violates the EvalExpectation contract (wrong version) still reads as invalid — this is a schema check, not just JSON.parse success", () => {
    renderModal();
    fireEvent.change(expectedOutputField(), {
      target: { value: JSON.stringify({ version: 2, must_find: [], must_not_flag: [] }) },
    });

    expect(screen.getByText("invalid JSON")).toBeInTheDocument();
    expect(screen.getByText("Save").closest("button")).toBeDisabled();
  });

  it("a well-formed EvalExpectation with entries re-validates as valid — badge flips back and Save re-enables", () => {
    renderModal();
    fireEvent.change(expectedOutputField(), {
      target: {
        value: JSON.stringify({
          version: 1,
          must_find: [{ file: "src/config.ts", start_line: 1, end_line: 1 }],
          must_not_flag: [],
        }),
      },
    });

    expect(screen.getByText("valid JSON")).toBeInTheDocument();
    expect(screen.getByText("Save").closest("button")).not.toBeDisabled();
  });
});
