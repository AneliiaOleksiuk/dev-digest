import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../messages/en/runs.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const AGENTS = [
  { id: "a1", name: "Security Reviewer", model: "gpt-4.1", enabled: true },
  { id: "a2", name: "Style Reviewer", model: "claude-3.5", enabled: false },
];

vi.mock("@/lib/hooks/core", () => ({
  usePulls: () => ({
    data: [{ id: "pr-1", number: 42, title: "Add rate limiting" }],
    isLoading: false,
  }),
}));
vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => ({ data: AGENTS, isLoading: false }),
}));
const mutate = vi.fn();
vi.mock("@/lib/hooks/multi-agent", () => ({
  useAgentStats: () => ({ data: [] }),
  useStartMultiAgentRun: () => ({ mutate, isPending: false }),
}));

import { ConfigureRunView } from "./ConfigureRunView";

afterEach(() => {
  cleanup();
  mutate.mockClear();
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("ConfigureRunView (smoke)", () => {
  it("defaults to every ENABLED agent selected", () => {
    renderWithIntl(<ConfigureRunView repoId="r1" onRunStarted={vi.fn()} />);
    expect(screen.getByText("1 agent selected")).toBeInTheDocument();
  });

  it("the run button is disabled until a PR is selected", () => {
    renderWithIntl(<ConfigureRunView repoId="r1" onRunStarted={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Run 1 agent/ })).toBeDisabled();
  });

  it("toggling an agent updates the selected count", () => {
    renderWithIntl(<ConfigureRunView repoId="r1" onRunStarted={vi.fn()} />);
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[1]!); // enable the disabled agent too
    expect(screen.getByText("2 agents selected")).toBeInTheDocument();
  });

  it("starts the batch with the selected PR + agent ids once a PR is chosen", () => {
    renderWithIntl(<ConfigureRunView repoId="r1" initialPrId="pr-1" onRunStarted={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Run 1 agent/ }));
    expect(mutate).toHaveBeenCalledWith({ prId: "pr-1", agentIds: ["a1"] }, expect.anything());
  });
});
