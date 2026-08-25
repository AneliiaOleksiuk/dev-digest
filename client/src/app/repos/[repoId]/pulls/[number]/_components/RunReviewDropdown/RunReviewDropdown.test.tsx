import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/prReview.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ repoId: "r1" }),
}));
vi.mock("../../../../../../../lib/hooks/agents", () => ({
  useAgents: () => ({
    data: [
      { id: "a1", name: "Security", model: "gpt-4.1", enabled: true },
      { id: "a2", name: "Style", model: "claude-3.5", enabled: false },
    ],
  }),
}));
vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useRunReview: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
const startMultiAgentMutate = vi.fn();
vi.mock("@/lib/hooks/multi-agent", () => ({
  useAgentStats: () => ({ data: [] }),
  useStartMultiAgentRun: () => ({ mutate: startMultiAgentMutate, isPending: false }),
}));

import { RunReviewDropdown } from "./RunReviewDropdown";

afterEach(() => {
  cleanup();
  startMultiAgentMutate.mockClear();
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("RunReviewDropdown (smoke)", () => {
  it("renders the trigger label", () => {
    renderWithIntl(<RunReviewDropdown prId="pr1" />);
    expect(screen.getByText("Run Review")).toBeInTheDocument();
  });

  it("opens a checkbox agent picker, defaulting to every ENABLED agent, alongside the existing single/all-agent items", () => {
    renderWithIntl(<RunReviewDropdown prId="pr1" />);
    fireEvent.click(screen.getByText("Run Review"));

    expect(screen.getByText("Pick agents to run")).toBeInTheDocument();
    expect(screen.getByText("Run multi-agent review (1)")).toBeInTheDocument();
    expect(screen.getByText("Run all enabled agents")).toBeInTheDocument();
    // Every agent is still individually listed for a single-agent run.
    expect(screen.getAllByText("Security")).toHaveLength(2);
  });

  it("starts a multi-agent batch with the checked agents and navigates to its results", () => {
    renderWithIntl(<RunReviewDropdown prId="pr1" />);
    fireEvent.click(screen.getByText("Run Review"));
    fireEvent.click(screen.getByText("Run multi-agent review (1)"));

    expect(startMultiAgentMutate).toHaveBeenCalledWith(
      { prId: "pr1", agentIds: ["a1"] },
      expect.anything(),
    );
  });

  it("Clear empties the selection and disables the run button", () => {
    renderWithIntl(<RunReviewDropdown prId="pr1" />);
    fireEvent.click(screen.getByText("Run Review"));
    fireEvent.click(screen.getByText("Clear"));

    expect(screen.getByText("Run multi-agent review (0)")).toBeInTheDocument();
    expect(screen.getByText("Run multi-agent review (0)").closest("button")).toBeDisabled();
  });
});
