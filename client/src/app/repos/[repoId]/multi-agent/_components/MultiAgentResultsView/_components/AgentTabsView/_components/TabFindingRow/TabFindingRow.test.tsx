import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import runsMessages from "../../../../../../../../../../../messages/en/runs.json";
import prReviewMessages from "../../../../../../../../../../../messages/en/prReview.json";

const findingActionMutate = vi.fn();
const evalCaseMutate = vi.fn();

vi.mock("@/lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: findingActionMutate, isPending: false }),
}));
vi.mock("@/lib/hooks/multi-agent", () => ({
  useTurnIntoEvalCase: () => ({ mutate: evalCaseMutate, isPending: false }),
}));

import { TabFindingRow } from "./TabFindingRow";

afterEach(() => {
  cleanup();
  findingActionMutate.mockReset();
  evalCaseMutate.mockReset();
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: runsMessages, prReview: prReviewMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const FINDING: FindingRecord = {
  id: "f1",
  severity: "WARNING",
  category: "bug",
  title: "N+1 query",
  file: "src/api/users.ts",
  start_line: 45,
  end_line: 45,
  rationale: "Loops over users and issues one query per user.",
  suggestion: null,
  confidence: 0.8,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

describe("TabFindingRow (smoke)", () => {
  it("renders the reused FindingCard's own title", () => {
    renderWithIntl(<TabFindingRow finding={FINDING} prId="pr-1" />);
    expect(screen.getByText("N+1 query")).toBeInTheDocument();
  });

  it("Learn sits in its own row, separate from Accept/Dismiss, and confirms 'Saved to memory'", () => {
    findingActionMutate.mockImplementation((_vars, opts) => opts?.onSuccess?.());
    renderWithIntl(<TabFindingRow finding={FINDING} prId="pr-1" />);
    fireEvent.click(screen.getByText("Learn"));
    expect(findingActionMutate).toHaveBeenCalledWith(
      { findingId: "f1", action: "learn", prId: "pr-1" },
      expect.anything(),
    );
    expect(screen.getByText("Saved to memory")).toBeInTheDocument();
  });

  it("Turn into eval case confirms with a lightweight notification only", () => {
    evalCaseMutate.mockImplementation((_id, opts) => opts?.onSuccess?.());
    renderWithIntl(<TabFindingRow finding={FINDING} prId="pr-1" />);
    fireEvent.click(screen.getByText("Turn into eval case"));
    expect(evalCaseMutate).toHaveBeenCalledWith("f1", expect.anything());
    expect(screen.getByText("Added to eval cases")).toBeInTheDocument();
  });
});
