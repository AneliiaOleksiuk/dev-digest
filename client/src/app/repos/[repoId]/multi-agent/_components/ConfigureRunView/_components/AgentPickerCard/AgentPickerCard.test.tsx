import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import type { AgentCostEstimate } from "@/lib/hooks/multi-agent";
import type { AgentVisual } from "../../../../agent-visuals";
import messages from "../../../../../../../../../messages/en/runs.json";

import { AgentPickerCard } from "./AgentPickerCard";

const VISUAL: AgentVisual = { icon: "Shield", color: "var(--crit)" };

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const AGENT: Agent = {
  id: "a1",
  name: "Security Reviewer",
  description: "",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "",
  output_schema: null,
  enabled: true,
  version: 1,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
};

function stats(overrides: Partial<AgentCostEstimate> = {}): AgentCostEstimate {
  return {
    agent_id: "a1",
    agent_name: "Security Reviewer",
    avg_duration_ms: 8200,
    avg_cost_usd: 0.06,
    sample_size: 12,
    ...overrides,
  };
}

describe("AgentPickerCard (smoke)", () => {
  it("shows the agent's estimate + sample size when stats exist", () => {
    renderWithIntl(<AgentPickerCard agent={AGENT} stats={stats()} visual={VISUAL} checked={false} onToggle={vi.fn()} />);
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText(/8\.2s/)).toBeInTheDocument();
    expect(screen.getByText("from 12 past runs")).toBeInTheDocument();
  });

  it("shows 'no estimate yet' — never a fabricated number — with no stats", () => {
    renderWithIntl(<AgentPickerCard agent={AGENT} stats={undefined} visual={VISUAL} checked={false} onToggle={vi.fn()} />);
    expect(screen.getByText("no estimate yet")).toBeInTheDocument();
  });

  it("shows a disabled marker for a disabled agent", () => {
    renderWithIntl(
      <AgentPickerCard agent={{ ...AGENT, enabled: false }} stats={undefined} visual={VISUAL} checked={false} onToggle={vi.fn()} />,
    );
    expect(screen.getByText(/disabled/)).toBeInTheDocument();
  });

  it("calls onToggle when the checkbox is clicked", () => {
    const onToggle = vi.fn();
    renderWithIntl(<AgentPickerCard agent={AGENT} stats={undefined} visual={VISUAL} checked={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onToggle).toHaveBeenCalledWith(true);
  });
});
