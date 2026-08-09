/**
 * BlastRadiusCard — right column of the 3-panel Overview row
 * (docs/plans/intent-layer.md WI13 panel 3 / Test plan). No blast-radius
 * compute/API exists anywhere in this codebase yet (WI13's own documented
 * Deviation — a follow-on feature, not a bug), so this card has exactly one
 * state: it must ALWAYS render the honest "unavailable" empty state and must
 * never fabricate a symbol/caller/endpoint tree.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import briefMessages from "../../../../../../../../messages/en/brief.json";
import { BlastRadiusCard } from "./BlastRadiusCard";

afterEach(cleanup);

function renderCard() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: briefMessages }}>
      <BlastRadiusCard />
    </NextIntlClientProvider>,
  );
}

describe("BlastRadiusCard", () => {
  it("always renders the honest 'unavailable' empty state — no fabricated symbol/caller tree", () => {
    renderCard();

    expect(screen.getByText("Blast radius")).toBeInTheDocument();
    expect(screen.getByText("Brief not available yet.")).toBeInTheDocument();
    expect(screen.getByText("Run a review or open the PR to compute it.")).toBeInTheDocument();
  });
});
