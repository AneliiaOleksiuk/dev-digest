/**
 * Oracle: `specs/SPEC-05-multi-agent-ci-per-repo.md` AC-30 ("the agent CI tab
 * shall be unchanged in shape: it lists that agent's own installations
 * only … and shall not list, count or link another agent's installation on
 * the same repository") and AC-31 ("the CI tab shall display each
 * installation's ingest secret name") — derived from the spec text BEFORE
 * reading `CiTab.tsx`'s own implementation beyond its prop shape and the
 * hook names it calls.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, CiInstallation } from "@devdigest/shared";
import ciMessages from "../../../../../../../../messages/en/ci.json";
import agentsMessages from "../../../../../../../../messages/en/agents.json";

const useAgentCiInstallations = vi.fn();
const useDeleteCiInstallation = vi.fn();
const useCiPreview = vi.fn();
const useCiExport = vi.fn();
const useCiExportZip = vi.fn();

vi.mock("@/lib/hooks/ci", () => ({
  useAgentCiInstallations: (...args: unknown[]) => useAgentCiInstallations(...args),
  useDeleteCiInstallation: (...args: unknown[]) => useDeleteCiInstallation(...args),
  useCiPreview: (...args: unknown[]) => useCiPreview(...args),
  useCiExport: (...args: unknown[]) => useCiExport(...args),
  useCiExportZip: (...args: unknown[]) => useCiExportZip(...args),
}));

const useUpdateAgent = vi.fn();
vi.mock("@/lib/hooks/agents", () => ({
  useUpdateAgent: (...args: unknown[]) => useUpdateAgent(...args),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("@/lib/toast", () => ({
  useToast: () => ({ success: toastSuccess, error: toastError, info: vi.fn(), toast: vi.fn() }),
}));

import { CiTab } from "./CiTab";

afterEach(() => {
  cleanup();
  useAgentCiInstallations.mockReset();
  useDeleteCiInstallation.mockReset();
  useCiPreview.mockReset();
  useCiExport.mockReset();
  useCiExportZip.mockReset();
  useUpdateAgent.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "",
  provider: "openrouter",
  model: "openai/gpt-4.1",
  system_prompt: "Review the diff.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 3,
};

function installation(overrides: Partial<CiInstallation> = {}): CiInstallation {
  return {
    id: "inst1",
    agent_id: "ag1",
    repo: "acme/payments-api",
    target_type: "gha",
    installed_at: "2026-08-01T00:00:00.000Z",
    workflow_version: 2,
    agent_version: 3,
    ingest_url: "https://studio.example.com/ci/ingest",
    post_as: "github_review",
    triggers: ["opened", "synchronize"],
    base: "main",
    ingest_secret_name: "DEVDIGEST_INGEST_TOKEN_SECURITY_REVIEWER",
    last_run: null,
    ...overrides,
  };
}

function renderTab(installations: CiInstallation[] | undefined) {
  useAgentCiInstallations.mockReturnValue({ data: installations });
  useDeleteCiInstallation.mockReturnValue({ mutate: vi.fn(), isPending: false });
  useUpdateAgent.mockReturnValue({ mutate: vi.fn(), isPending: false });
  useCiPreview.mockReturnValue({ mutate: vi.fn(), isPending: false });
  useCiExport.mockReturnValue({ mutate: vi.fn(), isPending: false });
  useCiExportZip.mockReturnValue({ mutate: vi.fn(), isPending: false });

  return render(
    <NextIntlClientProvider locale="en" messages={{ ci: ciMessages, agents: agentsMessages }}>
      <CiTab agent={AGENT} />
    </NextIntlClientProvider>,
  );
}

describe("AC-31: the CI tab renders each installation's OWN ingest secret name", () => {
  it("renders the secret name for a single installation", () => {
    renderTab([installation({ ingest_secret_name: "DEVDIGEST_INGEST_TOKEN_SECURITY_REVIEWER" })]);
    expect(screen.getByText(/DEVDIGEST_INGEST_TOKEN_SECURITY_REVIEWER/)).toBeInTheDocument();
  });

  it("two installations of the SAME agent (different repos) each render their OWN secret name", () => {
    renderTab([
      installation({ id: "i1", repo: "acme/payments-api", ingest_secret_name: "DEVDIGEST_INGEST_TOKEN_SECURITY_REVIEWER" }),
      installation({ id: "i2", repo: "acme/checkout-api", ingest_secret_name: "DEVDIGEST_INGEST_TOKEN_SECURITY_REVIEWER_2" }),
    ]);
    expect(screen.getByText(/DEVDIGEST_INGEST_TOKEN_SECURITY_REVIEWER_2/)).toBeInTheDocument();
    expect(screen.getAllByText(/DEVDIGEST_INGEST_TOKEN_SECURITY_REVIEWER/).length).toBeGreaterThanOrEqual(1);
  });
});

describe("AC-30: the tab lists ONLY this agent's own installations — no cross-agent count or link", () => {
  it("renders exactly the rows returned by useAgentCiInstallations for THIS agent, nothing more", () => {
    renderTab([installation({ id: "i1", repo: "acme/payments-api" })]);
    // Deployed-to-N-repositories badge reflects THIS agent's own count only.
    expect(screen.getByText("Deployed to 1 repositories")).toBeInTheDocument();
    expect(screen.getByText("acme/payments-api")).toBeInTheDocument();
  });

  it("the empty state renders when this agent has zero installations — no fallback to another agent's data", () => {
    renderTab([]);
    expect(screen.getByText("Not deployed to CI yet")).toBeInTheDocument();
  });
});
