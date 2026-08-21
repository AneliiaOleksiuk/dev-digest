import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../../../messages/en/agents.json";
import { ToastProvider } from "../../../../../lib/toast";

// Mock the data hooks so the editor renders without a network/query client.
vi.mock("../../../../../lib/hooks/agents", () => ({
  useUpdateAgent: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, data: undefined }),
  useProviderModels: () => ({ data: [{ id: "gpt-4.1", provider: "openai" }] }),
}));

vi.mock("./_components/ContextTab", () => ({
  ContextTab: () => <div>Attached documents</div>,
}));
vi.mock("./_components/SkillsTab", () => ({
  SkillsTab: () => <div>Linked skills</div>,
}));
// L06 WI12 — the Evals tab has its own EvalsTab.test.tsx covering its
// content; here we only need proof AgentEditor routes ?tab=evals to it.
vi.mock("./_components/EvalsTab", () => ({
  EvalsTab: () => <div>Eval metrics</div>,
}));

import { AgentEditor } from "./AgentEditor";
import { TAB_KEYS } from "./constants";

afterEach(cleanup);

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
      <ToastProvider>{ui}</ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("A2 Agent Editor (smoke)", () => {
  it("renders the Config tab fields", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="config" onTab={() => {}} />);
    expect(screen.getByText("Config")).toBeInTheDocument();
    expect(screen.getByText("Context")).toBeInTheDocument();
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Save agent")).toBeInTheDocument();
  });

  it("TAB_KEYS includes every editor tab so ?tab=context is not rejected by the page allow-list", () => {
    expect(TAB_KEYS).toContain("config");
    expect(TAB_KEYS).toContain("skills");
    expect(TAB_KEYS).toContain("context");
  });

  it("renders the Project Context panel when tab is context", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="context" onTab={() => {}} />);
    expect(screen.getByText("Attached documents")).toBeInTheDocument();
  });

  // L06 AC-34 — "?tab=evals renders the tab and does not snap back to
  // Config." `TAB_KEYS` (used by `agents/[id]/page.tsx`'s `?tab=` allow-list
  // as `TAB_KEYS.includes(requested) ? requested : "config"`) MUST contain
  // "evals" or the page-level guard would silently redirect to config before
  // AgentEditor ever sees `tab="evals"` — asserted directly here rather than
  // trusting AgentEditor's own render alone to prove the whole path.
  it("TAB_KEYS includes 'evals' so ?tab=evals is not rejected by the page allow-list (AC-34)", () => {
    expect(TAB_KEYS).toContain("evals");
  });

  it("renders the Evals tab (not Config) when tab is evals (AC-34)", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="evals" onTab={() => {}} />);
    expect(screen.getByText("Eval metrics")).toBeInTheDocument();
    expect(screen.queryByText("Configuration")).not.toBeInTheDocument();
  });
});
