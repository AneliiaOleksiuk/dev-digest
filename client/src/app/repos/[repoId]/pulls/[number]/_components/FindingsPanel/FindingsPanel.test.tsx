import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { ToastProvider } from "../../../../../../../lib/toast";

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));
// L06 — FindingsPanel now also calls useCreateEvalCaseFromFinding
// (the "Turn into eval case" action's mutation, WI11). `mutateEvalCase`
// resolves onSuccess synchronously so a UX-2 confirmation-text test below
// can observe the toast without a real QueryClientProvider or network.
//
// Phase D fix-loop — FindingsPanel now derives the confirmation's kind from
// the mutation's OWN response (`expected_output.must_find`/`.must_not_flag`,
// the server's authoritative derivation), not from `finding.accepted_at`
// client-side. This mock simulates that same server derivation
// (helpers.ts's `if (finding.acceptedAt) return 'must_find'`) keyed by the
// finding id each test below clicks, so the response shape stays realistic.
const KIND_BY_FINDING_ID: Record<string, "must_find" | "must_not_flag"> = {
  "f-accepted": "must_find",
  "f-dismissed": "must_not_flag",
  // Deliberately CONTRADICTS this finding's own accepted_at (see
  // ACCEPTED_CONTRADICTED below) — pins that the confirmation text follows
  // the mutation response, not a client-side re-derivation from timestamps.
  "f-accepted-contradicted": "must_not_flag",
};
type EvalCaseFromFindingResponse = {
  expected_output: { version: 1; must_find: unknown[]; must_not_flag: unknown[] };
};
const mutateEvalCase = vi.fn(
  (
    input: { findingId: string },
    opts?: { onSuccess?: (data: EvalCaseFromFindingResponse) => void; onError?: (e: unknown) => void },
  ) => {
    const kind = KIND_BY_FINDING_ID[input.findingId] ?? "must_find";
    opts?.onSuccess?.({
      expected_output: {
        version: 1,
        must_find: kind === "must_find" ? [{}] : [],
        must_not_flag: kind === "must_not_flag" ? [{}] : [],
      },
    });
  },
);
vi.mock("../../../../../../../lib/hooks/eval", () => ({
  useCreateEvalCaseFromFinding: () => ({
    mutate: (
      ...args: [{ findingId: string }, { onSuccess?: (data: EvalCaseFromFindingResponse) => void; onError?: (e: unknown) => void }?]
    ) => mutateEvalCase(...args),
    isPending: false,
  }),
}));

import { FindingsPanel } from "./FindingsPanel";

afterEach(() => {
  cleanup();
  mutateEvalCase.mockClear();
});

const FINDINGS: FindingRecord[] = [
  {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded secret",
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    rationale: "A secret is committed.",
    suggestion: null,
    confidence: 0.95,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
  },
  {
    id: "f2",
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
  },
];

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <ToastProvider>{ui}</ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("FindingsPanel (smoke)", () => {
  it("renders the toolbar + a finding card", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(screen.getByText("Hide low confidence")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("shows the empty state when nothing matches", () => {
    renderWithIntl(<FindingsPanel findings={[]} prId="pr1" />);
    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });

  it("severityFilter shows only findings of that severity + a clear chip", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" severityFilter="WARNING" />);
    expect(screen.getByText("N+1 query")).toBeInTheDocument();
    expect(screen.queryByText("Hardcoded secret")).not.toBeInTheDocument();
    expect(screen.getByText("Clear filter")).toBeInTheDocument();
  });

  it("clicking Clear filter calls onClearFilter", () => {
    const onClearFilter = vi.fn();
    renderWithIntl(
      <FindingsPanel findings={FINDINGS} prId="pr1" severityFilter="CRITICAL" onClearFilter={onClearFilter} />,
    );
    fireEvent.click(screen.getByText("Clear filter"));
    expect(onClearFilter).toHaveBeenCalled();
  });
});

/**
 * L06 UX-2 — "the confirmation must say 'will assert this IS found' or
 * 'will assert this is NOT flagged' — otherwise the most important fact
 * about the case is invisible at the moment it is created." Oracle derived
 * from the spec's UX improvements #2 and prReview.json's
 * evalCaseCreatedMustFind/evalCaseCreatedMustNotFlag copy, before reading
 * FindingsPanel.tsx's wiring.
 */
describe("FindingsPanel — Turn into eval case confirmation (L06 UX-2)", () => {
  const ACCEPTED: FindingRecord = { ...FINDINGS[0]!, id: "f-accepted", accepted_at: "2026-08-20T00:00:00.000Z" };
  const DISMISSED: FindingRecord = { ...FINDINGS[0]!, id: "f-dismissed", dismissed_at: "2026-08-20T00:00:00.000Z" };

  it("an ACCEPTED finding's confirmation states the case WILL assert the finding IS found", () => {
    renderWithIntl(<FindingsPanel findings={[ACCEPTED]} prId="pr1" />);
    fireEvent.click(screen.getByText("Turn into eval case"));
    expect(
      screen.getByText("Eval case created for src/config.ts — will assert this IS found"),
    ).toBeInTheDocument();
  });

  it("a DISMISSED finding's confirmation states the opposite — the case WILL assert the finding is NOT flagged", () => {
    renderWithIntl(<FindingsPanel findings={[DISMISSED]} prId="pr1" />);
    fireEvent.click(screen.getByText("Turn into eval case"));
    expect(
      screen.getByText("Eval case created for src/config.ts — will assert this is NOT flagged"),
    ).toBeInTheDocument();
  });

  it("follows the mutation's RESPONSE, not the finding's own accepted_at, when the two disagree (pins server-derived-only, not client re-derivation)", () => {
    // ACCEPTED (accepted_at set) — a client-side re-derivation from the
    // timestamp would say "IS found". The mocked response deliberately
    // returns must_not_flag instead; the confirmation must follow THAT.
    const ACCEPTED_CONTRADICTED: FindingRecord = {
      ...FINDINGS[0]!,
      id: "f-accepted-contradicted",
      accepted_at: "2026-08-20T00:00:00.000Z",
    };
    renderWithIntl(<FindingsPanel findings={[ACCEPTED_CONTRADICTED]} prId="pr1" />);
    fireEvent.click(screen.getByText("Turn into eval case"));
    expect(
      screen.getByText("Eval case created for src/config.ts — will assert this is NOT flagged"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Eval case created for src/config.ts — will assert this IS found")).not.toBeInTheDocument();
  });

  it("the mutation is called with only the finding id — the client never sends the expectation kind (AC-3/D-7: server-derived only)", () => {
    renderWithIntl(<FindingsPanel findings={[ACCEPTED]} prId="pr1" />);
    fireEvent.click(screen.getByText("Turn into eval case"));
    expect(mutateEvalCase).toHaveBeenCalledWith(
      { findingId: "f-accepted" },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });
});
