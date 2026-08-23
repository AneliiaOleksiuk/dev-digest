/**
 * Oracle: `specs/SPEC-05-multi-agent-ci-per-repo.md` AC-28 ("the wizard's
 * 'Secrets expected' panel … shall name THIS installation's ingest secret
 * rather than the literal DEVDIGEST_INGEST_TOKEN … Both shall keep stating
 * that DevDigest cannot read, set or verify a repository secret") — derived
 * from the spec text BEFORE reading `ConfigureStep.tsx`'s own implementation
 * beyond its prop shape.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import ciMessages from "../../../../../../../../../messages/en/ci.json";
import { ConfigureStep } from "./ConfigureStep";

afterEach(cleanup);

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
  version: 1,
};

function renderStep(ingestSecretName: string | null) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ ci: ciMessages }}>
      <ConfigureStep
        agent={AGENT}
        triggers={["opened", "synchronize"]}
        onToggleTrigger={vi.fn()}
        postAs="github_review"
        onPostAsChange={vi.fn()}
        ingestUrl="https://studio.example.com/ci/ingest"
        onIngestUrlChange={vi.fn()}
        ingestSecretName={ingestSecretName}
      />
    </NextIntlClientProvider>,
  );
}

describe("AC-28: the secrets panel names THIS installation's own ingest secret", () => {
  it("renders the server-supplied secret name once Preview has returned it", () => {
    renderStep("DEVDIGEST_INGEST_TOKEN_SECURITY_REVIEWER");
    expect(screen.getByText("DEVDIGEST_INGEST_TOKEN_SECURITY_REVIEWER")).toBeInTheDocument();
  });

  it("a different installation's own secret name renders as ITS name, not a shared literal", () => {
    renderStep("DEVDIGEST_INGEST_TOKEN_API_CONTRACT_REVIEWER");
    expect(screen.getByText("DEVDIGEST_INGEST_TOKEN_API_CONTRACT_REVIEWER")).toBeInTheDocument();
    expect(screen.queryByText("DEVDIGEST_INGEST_TOKEN_SECURITY_REVIEWER")).not.toBeInTheDocument();
  });

  it('still states the "cannot read, set or verify a repository secret" disclaimer', () => {
    renderStep("DEVDIGEST_INGEST_TOKEN_SECURITY_REVIEWER");
    expect(
      screen.getByText(/cannot read, set or verify a repository secret/i),
    ).toBeInTheDocument();
  });
});
