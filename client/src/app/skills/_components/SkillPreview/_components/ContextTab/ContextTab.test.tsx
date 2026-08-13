/**
 * ContextTab — implementer's own self-check (minimal; test-writer owns the
 * full suite per WI10's stated Definition of done: filtering narrows the
 * list while already-attached non-matching rows stay attached, and the
 * attached-set token total renders).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import skillsMessages from "../../../../../../../messages/en/skills.json";

const useContextDocuments = vi.fn();
const useContextDocument = vi.fn();
const useSkillContext = vi.fn();
const setSkillContextMutate = vi.fn();

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { id: "repo-1", full_name: "acme/widgets" } }),
}));
vi.mock("@/lib/hooks/context", () => ({
  useContextDocuments: (...args: unknown[]) => useContextDocuments(...args),
  useContextDocument: (...args: unknown[]) => useContextDocument(...args),
  useSkillContext: (...args: unknown[]) => useSkillContext(...args),
  useSetSkillContext: () => ({ mutate: setSkillContextMutate }),
}));

import { ContextTab } from "./ContextTab";

const SKILL: Skill = {
  id: "skill-1",
  name: "Security rubric",
  description: "d",
  type: "security",
  source: "manual",
  body: "b",
  enabled: true,
  version: 1,
  evidence_files: null,
};

afterEach(() => {
  cleanup();
  useContextDocuments.mockReset();
  useContextDocument.mockReset();
  useSkillContext.mockReset();
  setSkillContextMutate.mockReset();
});

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: skillsMessages }}>
      <ContextTab skill={SKILL} />
    </NextIntlClientProvider>,
  );
}

describe("ContextTab", () => {
  it("filtering narrows the list while an already-attached non-matching row stays attached, and the attached total renders", () => {
    useContextDocuments.mockReturnValue({
      data: {
        documents: [
          { path: "docs/adr/0001-x.md", source_folder: "docs", type: "md", tokens: 40, bytes: 200, used_by_agents: 0, missing: false },
          { path: "docs/notes.md", source_folder: "docs", type: "md", tokens: 20, bytes: 100, used_by_agents: 0, missing: false },
          { path: "specs/security.md", source_folder: "specs", type: "md", tokens: 60, bytes: 300, used_by_agents: 0, missing: false },
        ],
        total_tokens: 120,
        total_files: 3,
        degraded_reason: null,
      },
    });
    useSkillContext.mockReturnValue({
      data: { repo_id: "repo-1", documents: [{ path: "docs/adr/0001-x.md", order: 0 }], total_tokens: 40, other_repo_documents: [] },
    });
    useContextDocument.mockReturnValue({ data: undefined });

    renderTab();

    // Attached-set token total renders.
    expect(screen.getByText("Attached: ≈40 tokens")).toBeInTheDocument();

    // All rows visible before filtering.
    expect(screen.getByText("docs/adr/0001-x.md")).toBeInTheDocument();
    expect(screen.getByText("docs/notes.md")).toBeInTheDocument();
    expect(screen.getByText("specs/security.md")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search documents…"), { target: { value: "security" } });

    // The list narrows: the unattached, non-matching doc disappears.
    expect(screen.queryByText("docs/notes.md")).not.toBeInTheDocument();
    // Attached non-matching stays visible (AC-11).
    expect(screen.getByText("docs/adr/0001-x.md")).toBeInTheDocument();
    expect(screen.getByText("specs/security.md")).toBeInTheDocument();

    // Typing in the search box must not persist/mutate attachment state.
    expect(setSkillContextMutate).not.toHaveBeenCalled();
  });

  // test-writer addition — AC-11's own wording, quoted verbatim in both the
  // Spec and WI10's Definition of done: "type a query, assert the list
  // narrows and non-matching ATTACHED rows stay attached". The self-check
  // above only proves the list narrows down to matching rows; it never
  // attaches a document whose path doesn't match the typed query, so it
  // can't catch a regression where filtering hides an attached document.
  // Kept per the two-phase rule even though it fails against the current
  // implementation — see "Behavior mismatches found" in this session's
  // report: `ContextTab/helpers.ts`'s `matchesQuery` filters ALL rows,
  // attached or not, with no attached-stays-visible carve-out.
  it("AC-11: an attached document that does NOT match the typed query stays visible in the list", () => {
    useContextDocuments.mockReturnValue({
      data: {
        documents: [
          { path: "docs/adr/0001-x.md", source_folder: "docs", type: "md", tokens: 40, bytes: 200, used_by_agents: 0, missing: false },
          { path: "specs/security.md", source_folder: "specs", type: "md", tokens: 60, bytes: 300, used_by_agents: 0, missing: false },
        ],
        total_tokens: 100,
        total_files: 2,
        degraded_reason: null,
      },
    });
    // docs/adr/0001-x.md is ATTACHED; it does not contain the string
    // "security" anywhere in its path or type.
    useSkillContext.mockReturnValue({
      data: { repo_id: "repo-1", documents: [{ path: "docs/adr/0001-x.md", order: 0 }], total_tokens: 40, other_repo_documents: [] },
    });
    useContextDocument.mockReturnValue({ data: undefined });

    renderTab();
    fireEvent.change(screen.getByPlaceholderText("Search documents…"), { target: { value: "security" } });

    // The attached row must stay visible even though it doesn't match the
    // query — only non-attached, non-matching rows should be hidden.
    expect(screen.getByText("docs/adr/0001-x.md")).toBeInTheDocument();
    expect(screen.getByText("specs/security.md")).toBeInTheDocument();
  });
});
