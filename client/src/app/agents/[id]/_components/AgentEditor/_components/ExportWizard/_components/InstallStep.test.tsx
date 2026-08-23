/**
 * Oracle: `specs/SPEC-05-multi-agent-ci-per-repo.md` AC-12 ("the client
 * shall … drop the 'A different agent is already installed here' /
 * 'Replace existing installation' dialog and its copy") and AC-28 ("the
 * one-time token dialog shall tell the user the exact secret name to paste
 * it under") — derived from the spec text and `docs/plans/spec-05-multi-agent-ci-per-repo.md`
 * WI6 ("InstallStep.tsx: delete the 409 conflict branch and its box …
 * onInstall loses its replaceExisting parameter; the one-time token dialog
 * names the exact secret to paste under") BEFORE reading `InstallStep.tsx`'s
 * own implementation beyond its prop shape.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import ciMessages from "../../../../../../../../../messages/en/ci.json";
import { InstallStep } from "./InstallStep";

afterEach(cleanup);

interface StepOverrides {
  install?: Record<string, unknown>;
  zip?: Record<string, unknown>;
  onInstall?: () => void;
  onZip?: () => void;
  onAcknowledgeToken?: () => void;
  onClose?: () => void;
}

function renderStep(overrides: StepOverrides = {}) {
  const install = {
    isSuccess: false,
    isPending: false,
    isError: false,
    error: null,
    data: undefined,
    ...overrides.install,
  } as any;
  const zip = { isSuccess: false, isPending: false, isError: false, error: null, ...overrides.zip } as any;

  return render(
    <NextIntlClientProvider locale="en" messages={{ ci: ciMessages }}>
      <InstallStep
        repo="acme/payments-api"
        filesCount={4}
        install={install}
        zip={zip}
        onInstall={overrides.onInstall ?? vi.fn()}
        onZip={overrides.onZip ?? vi.fn()}
        onAcknowledgeToken={overrides.onAcknowledgeToken ?? vi.fn()}
        onClose={overrides.onClose ?? vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

describe("AC-12: no replace-existing / conflict confirmation is ever rendered on the gha path", () => {
  it("the pre-install view never renders conflict copy, regardless of install state", () => {
    renderStep();
    expect(screen.queryByText(/already installed here/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/replace existing/i)).not.toBeInTheDocument();
  });

  it("the post-install success view also never renders conflict copy", () => {
    renderStep({
      install: {
        isSuccess: true,
        data: {
          installation: { ingest_secret_name: "DEVDIGEST_INGEST_TOKEN_SECURITY_REVIEWER" },
          pr_url: "https://github.com/acme/payments-api/pull/1",
          ingest_token: "plaintext-token-value",
        },
      },
    });
    expect(screen.queryByText(/already installed here/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/replace existing/i)).not.toBeInTheDocument();
  });
});

describe("AC-28: the one-time token dialog names THIS installation's exact secret", () => {
  it("the warning text includes the server-supplied ingest_secret_name, not a generic literal", () => {
    renderStep({
      install: {
        isSuccess: true,
        data: {
          installation: { ingest_secret_name: "DEVDIGEST_INGEST_TOKEN_SECURITY_REVIEWER" },
          pr_url: "https://github.com/acme/payments-api/pull/1",
          ingest_token: "plaintext-token-value",
        },
      },
    });
    expect(screen.getByText(/DEVDIGEST_INGEST_TOKEN_SECURITY_REVIEWER/)).toBeInTheDocument();
    // The actual token VALUE is shown once for copying — but never confused
    // with the SECRET NAME string above (distinct pieces of text).
    expect(screen.getByText("plaintext-token-value")).toBeInTheDocument();
  });

  it("a DIFFERENT installation's secret name renders its OWN name, not a shared/generic one", () => {
    renderStep({
      install: {
        isSuccess: true,
        data: {
          installation: { ingest_secret_name: "DEVDIGEST_INGEST_TOKEN_API_CONTRACT_REVIEWER" },
          pr_url: "https://github.com/acme/payments-api/pull/1",
          ingest_token: "another-token-value",
        },
      },
    });
    expect(screen.getByText(/DEVDIGEST_INGEST_TOKEN_API_CONTRACT_REVIEWER/)).toBeInTheDocument();
    expect(screen.queryByText(/DEVDIGEST_INGEST_TOKEN_SECURITY_REVIEWER/)).not.toBeInTheDocument();
  });
});
