import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingGroup, FindingRecord } from "@devdigest/shared";
import runsMessages from "../../../../../../../../../messages/en/runs.json";
import prReviewMessages from "../../../../../../../../../messages/en/prReview.json";

const mutate = vi.fn();
vi.mock("@/lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate, isPending: false }),
}));

import { FindingGroupsSection } from "./FindingGroupsSection";

afterEach(() => {
  cleanup();
  mutate.mockReset();
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: runsMessages, prReview: prReviewMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function group(overrides: Partial<FindingGroup> = {}): FindingGroup {
  return {
    file: "src/api/users.ts",
    normalized_file: "src/api/users.ts",
    start_line: 45,
    end_line: 47,
    category: "bug",
    members: [
      {
        id: "f1",
        run_id: "run-1",
        agent_id: "a1",
        agent_name: "Security",
        severity: "WARNING",
        title: "N+1 query (Security's take)",
        rationale: "Loops over users.",
        suggestion: null,
        confidence: 0.8,
      },
      {
        id: "f2",
        run_id: "run-2",
        agent_id: "a2",
        agent_name: "Perf",
        severity: "WARNING",
        title: "N+1 query (Perf's take)",
        rationale: "Same spot, perf angle.",
        suggestion: "Batch the query.",
        confidence: 0.7,
      },
    ],
    ...overrides,
  };
}

const findingsById = new Map<string, FindingRecord>();

describe("FindingGroupsSection (smoke)", () => {
  it("is collapsed by default, naming every contributing agent on the summary line", () => {
    renderWithIntl(<FindingGroupsSection groups={[group()]} findingsById={findingsById} prId="pr-1" />);
    expect(screen.getByText(/Security, Perf/)).toBeInTheDocument();
    expect(screen.queryByText("N+1 query (Security's take)")).not.toBeInTheDocument();
  });

  it("expanding shows EACH agent's own title verbatim — never merged", () => {
    renderWithIntl(<FindingGroupsSection groups={[group()]} findingsById={findingsById} prId="pr-1" />);
    fireEvent.click(screen.getByText(/Security, Perf/));
    expect(screen.getByText("N+1 query (Security's take)")).toBeInTheDocument();
    expect(screen.getByText("N+1 query (Perf's take)")).toBeInTheDocument();
  });

  it("a group of one (single agent) still renders", () => {
    const solo = group({ members: [group().members[0]!] });
    renderWithIntl(<FindingGroupsSection groups={[solo]} findingsById={findingsById} prId="pr-1" />);
    expect(screen.getByText(/^Security —/)).toBeInTheDocument();
  });

  it("shows the pre-authored empty state when there are no groups", () => {
    renderWithIntl(<FindingGroupsSection groups={[]} findingsById={findingsById} prId="pr-1" />);
    expect(screen.getByText("No grouped findings yet.")).toBeInTheDocument();
  });
});
