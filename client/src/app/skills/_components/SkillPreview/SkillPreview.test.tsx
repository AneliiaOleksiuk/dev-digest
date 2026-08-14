/**
 * SkillPreview — the Context tab must be in the tab bar of the Skills
 * list preview (same class of bug as the Agent editor ?tab= allow-list:
 * the panel existed, the chrome didn't surface it).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import skillsMessages from "../../../../../messages/en/skills.json";

const useContextDocuments = vi.fn();
const useContextDocument = vi.fn();
const useSkillContext = vi.fn();

vi.mock("@/lib/hooks/skills", () => ({
  useUpdateSkill: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useSkillVersions: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { id: "repo-1", full_name: "acme/widgets" } }),
}));
vi.mock("@/lib/hooks/context", () => ({
  useContextDocuments: (...args: unknown[]) => useContextDocuments(...args),
  useContextDocument: (...args: unknown[]) => useContextDocument(...args),
  useSkillContext: (...args: unknown[]) => useSkillContext(...args),
  useSetSkillContext: () => ({ mutate: vi.fn() }),
}));

import { SkillPreview } from "./SkillPreview";

const SKILL: Skill = {
  id: "skill-1",
  name: "pr-quality-rubric",
  description: "d",
  type: "custom",
  source: "manual",
  body: "body",
  enabled: true,
  version: 1,
  evidence_files: null,
};

afterEach(() => {
  cleanup();
  useContextDocuments.mockReset();
  useContextDocument.mockReset();
  useSkillContext.mockReset();
});

function renderPreview() {
  useContextDocuments.mockReturnValue({
    data: {
      documents: [
        {
          path: "specs/public-api.md",
          source_folder: "specs",
          type: "md",
          tokens: 40,
          bytes: 200,
          used_by_agents: 0,
          missing: false,
        },
      ],
      total_tokens: 40,
      total_files: 1,
      degraded_reason: null,
    },
  });
  useSkillContext.mockReturnValue({
    data: { repo_id: "repo-1", documents: [], total_tokens: 0, other_repo_documents: [] },
  });
  useContextDocument.mockReturnValue({ data: undefined });

  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: skillsMessages }}>
      <SkillPreview skill={SKILL} />
    </NextIntlClientProvider>,
  );
}

describe("SkillPreview", () => {
  it("shows a Context tab in the preview chrome, next to Overview", () => {
    renderPreview();
    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(screen.getByText("Context")).toBeInTheDocument();
    expect(screen.getByText("Version History")).toBeInTheDocument();
  });

  it("opens the attach panel when Context is clicked", () => {
    renderPreview();
    fireEvent.click(screen.getByText("Context"));
    expect(screen.getByText("Attached documents")).toBeInTheDocument();
    expect(screen.getByText("Any agent using this skill inherits these documents.")).toBeInTheDocument();
  });
});
