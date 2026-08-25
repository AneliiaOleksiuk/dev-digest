import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../messages/en/runs.json";

const replace = vi.fn();
let searchParams = new URLSearchParams();
let repoNotFound = false;

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "repo-1" }),
  useRouter: () => ({ replace }),
  useSearchParams: () => searchParams,
}));
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { full_name: "acme/widgets" } }),
  useRepoNotFound: () => repoNotFound,
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/repo-not-found", () => ({
  RepoNotFound: () => <div>repo not found</div>,
}));
vi.mock("../ConfigureRunView", () => ({
  ConfigureRunView: () => <div>configure screen</div>,
}));
vi.mock("../MultiAgentResultsView", () => ({
  MultiAgentResultsView: ({ runId }: { runId: string }) => <div>results screen for {runId}</div>,
}));

import { MultiAgentPageView } from "./MultiAgentPageView";

afterEach(() => {
  cleanup();
  searchParams = new URLSearchParams();
  repoNotFound = false;
  replace.mockClear();
});

function renderWithIntl() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      <MultiAgentPageView />
    </NextIntlClientProvider>,
  );
}

describe("MultiAgentPageView (smoke)", () => {
  it("shows the configure screen when there is no ?run= in the URL", () => {
    renderWithIntl();
    expect(screen.getByText("configure screen")).toBeInTheDocument();
  });

  it("shows the results screen for the batch id once ?run= is set", () => {
    searchParams = new URLSearchParams({ run: "batch-1" });
    renderWithIntl();
    expect(screen.getByText("results screen for batch-1")).toBeInTheDocument();
  });

  it("renders the repo-not-found empty state instead of either screen when the repo is unknown", () => {
    repoNotFound = true;
    renderWithIntl();
    expect(screen.getByText("repo not found")).toBeInTheDocument();
    expect(screen.queryByText("configure screen")).not.toBeInTheDocument();
  });
});
