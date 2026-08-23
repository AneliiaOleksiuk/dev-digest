/**
 * ContextTab (Agent) — implementer's own self-check (minimal; test-writer
 * owns the full suite per WI11's stated Definition of done: inherited and
 * direct documents render in separate groups, a disabled skill's document
 * appears in neither and is excluded from the total).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, AgentSkillLink, Skill } from "@devdigest/shared";
import agentsMessages from "../../../../../../../../messages/en/agents.json";

const useContextDocuments = vi.fn();
const useContextDocument = vi.fn();
const useAgentContext = vi.fn();
const useSkillContexts = vi.fn();

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { id: "repo-1", full_name: "acme/widgets" } }),
}));
vi.mock("@/lib/hooks/agents", () => ({
  useAgentSkills: () =>
    ({
      data: [
        { agent_id: "ag1", skill_id: "skill-enabled", order: 0 },
        { agent_id: "ag1", skill_id: "skill-disabled", order: 1 },
      ] satisfies AgentSkillLink[],
    }),
}));
vi.mock("@/lib/hooks/skills", () => ({
  useSkills: () =>
    ({
      data: [
        { id: "skill-enabled", name: "Enabled Skill", description: "d", type: "custom", source: "manual", body: "b", enabled: true, version: 1, evidence_files: null },
        { id: "skill-disabled", name: "Disabled Skill", description: "d", type: "custom", source: "manual", body: "b", enabled: false, version: 1, evidence_files: null },
      ] satisfies Skill[],
    }),
}));
vi.mock("@/lib/hooks/context", () => ({
  useContextDocuments: (...args: unknown[]) => useContextDocuments(...args),
  useContextDocument: (...args: unknown[]) => useContextDocument(...args),
  useAgentContext: (...args: unknown[]) => useAgentContext(...args),
  useSetAgentContext: () => ({ mutate: vi.fn() }),
  useSkillContexts: (...args: unknown[]) => useSkillContexts(...args),
}));

import { ContextTab } from "./ContextTab";

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "d",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "p",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

afterEach(() => {
  cleanup();
  useContextDocuments.mockReset();
  useContextDocument.mockReset();
  useAgentContext.mockReset();
  useSkillContexts.mockReset();
});

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: agentsMessages }}>
      <ContextTab agent={AGENT} />
    </NextIntlClientProvider>,
  );
}

describe("ContextTab (agent)", () => {
  it("shows inherited (enabled-skill-only) and direct documents in separate groups, excluding the disabled skill from both the list and the total", () => {
    useContextDocuments.mockReturnValue({
      data: {
        documents: [
          { path: "docs/from-enabled.md", source_folder: "docs", type: "md", tokens: 10, bytes: 50, used_by_agents: 0, missing: false },
          { path: "docs/from-disabled.md", source_folder: "docs", type: "md", tokens: 20, bytes: 60, used_by_agents: 0, missing: false },
          { path: "docs/direct-only.md", source_folder: "docs", type: "md", tokens: 30, bytes: 70, used_by_agents: 0, missing: false },
        ],
        total_tokens: 60,
        total_files: 3,
        degraded_reason: null,
      },
    });
    // Only ONE query is issued — for the enabled skill (skill-disabled is
    // filtered out before useSkillContexts is called).
    useSkillContexts.mockImplementation((skillIds: string[]) =>
      skillIds.map(() => ({
        data: {
          repo_id: "repo-1",
          documents: [{ path: "docs/from-enabled.md", order: 0 }],
          total_tokens: 10,
          other_repo_documents: [],
        },
      })),
    );
    useAgentContext.mockReturnValue({
      data: {
        repo_id: "repo-1",
        documents: [{ path: "docs/direct-only.md", order: 0 }],
        total_tokens: 30,
        other_repo_documents: [],
      },
    });
    useContextDocument.mockReturnValue({ data: undefined });

    renderTab();

    // Inherited group: only the enabled skill's document is labelled with
    // its source skill — the disabled skill contributes no "via" label at
    // all (E-7), even though its document still appears in the direct
    // group's pick list (any discovered document is attachable directly).
    expect(screen.getByText("via Enabled Skill")).toBeInTheDocument();
    expect(screen.queryByText(/via Disabled Skill/)).not.toBeInTheDocument();

    // The directly-attached document renders (in the direct group).
    expect(screen.getAllByText("docs/direct-only.md").length).toBeGreaterThan(0);

    // Total = inherited (10) + direct (30); the disabled skill's 20 is
    // excluded from both the list and the total (E-7).
    expect(screen.getByText("Effective total: ≈40 tokens")).toBeInTheDocument();
  });

  it("shows other-repo attachments as a read-only group marked not injected (E-8 / WI11)", () => {
    useContextDocuments.mockReturnValue({
      data: {
        documents: [
          { path: "docs/direct-only.md", source_folder: "docs", type: "md", tokens: 30, bytes: 70, used_by_agents: 0, missing: false },
        ],
        total_tokens: 30,
        total_files: 1,
        degraded_reason: null,
      },
    });
    useSkillContexts.mockReturnValue([]);
    useAgentContext.mockReturnValue({
      data: {
        repo_id: "repo-1",
        documents: [{ path: "docs/direct-only.md", order: 0 }],
        total_tokens: 30,
        other_repo_documents: [{ repo_id: "repo-2", path: "docs/other-repo.md", order: 0 }],
      },
    });
    useContextDocument.mockReturnValue({ data: undefined });

    renderTab();

    expect(screen.getByText("Attached on other repos")).toBeInTheDocument();
    expect(screen.getByText("docs/other-repo.md")).toBeInTheDocument();
    expect(screen.getByText("not injected for runs on this repo")).toBeInTheDocument();
    expect(screen.getByText("Effective total: ≈30 tokens")).toBeInTheDocument();
  });
});
