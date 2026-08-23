import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { FindingCard } from "./FindingCard";

afterEach(cleanup);

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A **live** Stripe key is committed in source.",
  suggestion: "Move the key to an environment variable.",
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingCard (smoke, both themes)", () => {
  (["dark", "light"] as const).forEach((theme) => {
    it(`renders severity + file:line + rationale in ${theme}`, () => {
      renderWithIntl(
        <div data-theme={theme}>
          <FindingCard finding={FINDING} defaultExpanded onAction={() => {}} />
        </div>,
      );
      expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
      expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
      // category label is shown alongside the severity badge
      expect(screen.getByText("security")).toBeInTheDocument();
    });
  });

  it("fires accept/dismiss actions", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard finding={FINDING} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByText("Accept"));
    expect(onAction).toHaveBeenCalledWith("accept");
    fireEvent.click(screen.getByText("Dismiss"));
    expect(onAction).toHaveBeenCalledWith("dismiss");
  });
});

/**
 * L06 AC-4/UX-1 — "Turn into eval case" is offered ONLY once a decision
 * (accept or dismiss) exists to derive the expectation kind from
 * (docs/plans/eval-pipeline.md WI11 DoD: "component tests over all three
 * finding states (pending / accepted / dismissed) show the action only in
 * the last two"). Oracle derived from the plan/spec before reading
 * FindingCard.tsx — `accepted_at`/`dismissed_at` are the two booleans the
 * card already derives (spec AC-4).
 */
describe("FindingCard — Turn into eval case (L06 AC-4/UX-1)", () => {
  const PENDING: FindingRecord = { ...FINDING, accepted_at: null, dismissed_at: null };
  const ACCEPTED: FindingRecord = { ...FINDING, accepted_at: "2026-08-20T00:00:00.000Z", dismissed_at: null };
  const DISMISSED: FindingRecord = { ...FINDING, accepted_at: null, dismissed_at: "2026-08-20T00:00:00.000Z" };

  it("is NOT offered on a pending finding (neither accepted nor dismissed)", () => {
    renderWithIntl(<FindingCard finding={PENDING} defaultExpanded onAction={() => {}} onCreateEvalCase={() => {}} />);
    expect(screen.queryByText("Turn into eval case")).not.toBeInTheDocument();
  });

  it("IS offered on an accepted finding", () => {
    renderWithIntl(<FindingCard finding={ACCEPTED} defaultExpanded onAction={() => {}} onCreateEvalCase={() => {}} />);
    expect(screen.getByText("Turn into eval case")).toBeInTheDocument();
  });

  it("IS offered on a dismissed finding", () => {
    renderWithIntl(<FindingCard finding={DISMISSED} defaultExpanded onAction={() => {}} onCreateEvalCase={() => {}} />);
    expect(screen.getByText("Turn into eval case")).toBeInTheDocument();
  });

  it("clicking it invokes onCreateEvalCase", () => {
    const onCreateEvalCase = vi.fn();
    renderWithIntl(
      <FindingCard finding={ACCEPTED} defaultExpanded onAction={() => {}} onCreateEvalCase={onCreateEvalCase} />,
    );
    fireEvent.click(screen.getByText("Turn into eval case"));
    expect(onCreateEvalCase).toHaveBeenCalledTimes(1);
  });
});
