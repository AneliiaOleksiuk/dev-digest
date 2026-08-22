/**
 * EvalCompareView — the read-only two-batch compare view (L06 WI13).
 *
 * Oracle (derived from docs/plans/eval-pipeline.md WI13 and
 * specs/eval-pipeline.md AC-32/UX-8/E-16 BEFORE reading EvalCompareView.tsx):
 *   - AC-32/UX-8: "The comparison shall include both batches' system
 *     prompts, read from agent_versions.config_json ... so the diff shown is
 *     the config that actually ran and not the agent's current config. IF a
 *     snapshot for a recorded version is missing, THEN the comparison shall
 *     render the metrics and state the prompt is unavailable, rather than
 *     substituting the current prompt."
 *   - E-16: "cost_usd is nullable throughout; the cost column and the cost
 *     delta must render null without inventing a figure."
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalBatchRecord, EvalComparison } from "@/lib/types";
import evalMessages from "../../../../../messages/en/eval.json";

const useEvalCompare = vi.fn();

vi.mock("@/lib/hooks/eval", () => ({
  useEvalCompare: (...args: unknown[]) => useEvalCompare(...args),
}));

import { EvalCompareView } from "./EvalCompareView";

afterEach(() => {
  cleanup();
  useEvalCompare.mockReset();
});

function renderCompare() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <EvalCompareView agentId="ag1" baseId="b0" headId="b1" onClose={() => {}} />
    </NextIntlClientProvider>,
  );
}

const BASE_BATCH: EvalBatchRecord = {
  id: "b0",
  owner_kind: "agent",
  owner_id: "ag1",
  agent_version: 5,
  provider: "openai",
  model: "gpt-4.1",
  skills_fingerprint: [],
  ran_at: "2026-08-10T00:00:00.000Z",
  status: "completed",
  cases_total: 8,
  cases_passed: 7,
  cases_failed: 1,
  recall: 0.9,
  precision: 0.9,
  citation_accuracy: 0.95,
  recall_cases: 8,
  precision_cases: 8,
  citation_cases: 8,
  findings_total: 12,
  duration_ms: 4000,
  cost_usd: 0.02,
  error: null,
};

const HEAD_BATCH: EvalBatchRecord = {
  ...BASE_BATCH,
  id: "b1",
  agent_version: 6,
  ran_at: "2026-08-20T00:00:00.000Z",
  cases_passed: 2,
  cases_failed: 6,
  precision: 0.3,
  cost_usd: null,
};

describe("EvalCompareView — AC-32/UX-8 each batch shows its OWN snapshot prompt, never the live prompt", () => {
  it("renders the base batch's snapshot prompt verbatim, and 'prompt unavailable' for the head batch's missing snapshot", () => {
    const comparison: EvalComparison = {
      base: BASE_BATCH,
      head: HEAD_BATCH,
      delta: { recall: 0, precision: -0.6, citation_accuracy: -0.05, cost_usd: null },
      base_prompt: "You are a strict security reviewer. Flag every secret.",
      head_prompt: null,
    };
    useEvalCompare.mockReturnValue({ data: comparison, isLoading: false, isError: false, refetch: vi.fn() });

    renderCompare();

    expect(screen.getByText("You are a strict security reviewer. Flag every secret.")).toBeInTheDocument();
    expect(screen.getByText("Prompt snapshot unavailable for this version")).toBeInTheDocument();
    // v5 and v6 each label their OWN column with their OWN recorded version.
    expect(screen.getByText("v5")).toBeInTheDocument();
    expect(screen.getByText("v6")).toBeInTheDocument();
  });
});

describe("EvalCompareView — prompt diff highlights changed lines instead of dumping both prompts side by side", () => {
  it("renders unchanged lines once, and marks only the added/removed lines", () => {
    const comparison: EvalComparison = {
      base: BASE_BATCH,
      head: HEAD_BATCH,
      delta: { recall: 0, precision: -0.6, citation_accuracy: -0.05, cost_usd: null },
      base_prompt: "You are a reviewer.\nFlag secrets.",
      head_prompt: "You are a reviewer.\nFlag secrets.\nFlag unused imports.",
    };
    useEvalCompare.mockReturnValue({ data: comparison, isLoading: false, isError: false, refetch: vi.fn() });

    renderCompare();

    // The shared line appears exactly once — a side-by-side dump would show it twice.
    expect(screen.getAllByText("You are a reviewer.")).toHaveLength(1);
    expect(screen.getByText("Flag unused imports.")).toBeInTheDocument();
  });
});

describe("EvalCompareView — E-16 a null cost delta renders null, never an invented figure", () => {
  it("the cost delta tile shows an em dash, not $0.00 or any fabricated amount", () => {
    const comparison: EvalComparison = {
      base: BASE_BATCH,
      head: HEAD_BATCH,
      delta: { recall: 0, precision: -0.6, citation_accuracy: -0.05, cost_usd: null },
      base_prompt: "prompt A",
      head_prompt: "prompt B",
    };
    useEvalCompare.mockReturnValue({ data: comparison, isLoading: false, isError: false, refetch: vi.fn() });

    renderCompare();

    const costDeltaLabel = screen.getByText("Cost Δ");
    expect(costDeltaLabel.parentElement?.textContent).toContain("—");
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  });
});
