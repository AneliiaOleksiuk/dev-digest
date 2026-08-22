import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Conflict } from "@devdigest/shared";
import messages from "../../../../../../../../../messages/en/runs.json";

import { DisagreementSection } from "./DisagreementSection";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const CONFLICTS: Conflict[] = [
  {
    file: "src/api/users.ts",
    line: 45,
    title: "N+1 query",
    takes: [
      { agent_id: "a1", persona: "Security", verdict: "WARNING", note: "Flagged as a warning." },
      { agent_id: "a2", persona: "Style", verdict: "ignored", note: "Out of this agent's focus area." },
    ],
  },
];

// Every participating agent flagged it and agrees on severity — AC-30's
// genuinely-not-a-conflict case (no silence, no severity divergence).
const ALL_AGREE: Conflict[] = [
  {
    file: "src/lib/cache.ts",
    line: 12,
    title: "Missing cache invalidation",
    takes: [
      { agent_id: "a1", persona: "Security", verdict: "WARNING", note: "" },
      { agent_id: "a2", persona: "Perf", verdict: "WARNING", note: "" },
    ],
  },
];

describe("DisagreementSection (smoke)", () => {
  it("shows one row per contended location with a severity chip + a styled 'did not flag' cell", () => {
    renderWithIntl(<DisagreementSection conflicts={CONFLICTS} />);
    expect(screen.getByText(/N\+1 query/)).toBeInTheDocument();
    expect(screen.getByText("did not flag")).toBeInTheDocument();
    expect(screen.getByText("Out of this agent's focus area.")).toBeInTheDocument();
  });

  it("'Show only conflicts' defaults OFF and shows every shared location, including a silent participant (AC-30)", () => {
    renderWithIntl(<DisagreementSection conflicts={CONFLICTS} />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    // This fixture has a silent/'ignored' participant — AC-30 treats that as
    // a genuine conflict on its own, so toggling ON must KEEP it visible.
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.getByText(/N\+1 query/)).toBeInTheDocument();
  });

  it("'Show only conflicts' ON hides a row where every agent agrees (no silence, no severity divergence)", () => {
    renderWithIntl(<DisagreementSection conflicts={ALL_AGREE} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.getByText("No conflicts — the agents agree on every flagged location.")).toBeInTheDocument();
  });

  it("shows the pre-authored empty state when there are no conflicts at all", () => {
    renderWithIntl(<DisagreementSection conflicts={[]} />);
    expect(screen.getByText("No conflicts — the agents agree on every flagged location.")).toBeInTheDocument();
  });
});
