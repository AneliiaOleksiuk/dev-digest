/**
 * RegenerateConfirmModal (WI12, FIX-6) — the confirmation gate for BOTH the
 * first-ever generation and a Regenerate.
 *
 * Oracle (derived BEFORE reading the component): AC-6 ("the system shall
 * require an explicit confirmation before issuing the call, and that
 * confirmation shall state both consequences: one model call is spent, and
 * the tour every member of the workspace sees is replaced", D-14, E-13) and
 * WI12's DoD ("a component test exists asserting the generate request is NOT
 * issued until the confirmation is accepted, and that the confirmation text
 * names both consequences"). Plus the fix plan's FIX-6: confirmation is now
 * required before the FIRST generation too, and `mode: "generate" |
 * "regenerate"` swaps the copy — a first-ever generation has no existing
 * tour to "replace", so its copy must say "creates", not "replaces".
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import onboardingMessages from "../../../../../../../../../messages/en/onboarding.json";

import { RegenerateConfirmModal } from "./RegenerateConfirmModal";

afterEach(cleanup);

function renderModal(
  onConfirm: () => void,
  onClose: () => void,
  mode?: "generate" | "regenerate",
) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: onboardingMessages }}>
      <RegenerateConfirmModal onConfirm={onConfirm} onClose={onClose} mode={mode} />
    </NextIntlClientProvider>,
  );
}

describe("RegenerateConfirmModal", () => {
  it("AC-6: does NOT call onConfirm merely by rendering — the call is gated behind an explicit click", () => {
    const onConfirm = vi.fn();
    renderModal(onConfirm, vi.fn());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("AC-6/D-14: names BOTH consequences — one paid model call, AND the shared tour is replaced for the workspace", () => {
    renderModal(vi.fn(), vi.fn());
    expect(
      screen.getByText(/spends one paid model call, and replaces the tour every member of your workspace sees/i),
    ).toBeInTheDocument();
  });

  it("clicking the confirm CTA calls onConfirm exactly once", () => {
    const onConfirm = vi.fn();
    renderModal(onConfirm, vi.fn());
    fireEvent.click(screen.getByText("Regenerate now"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("clicking cancel calls onClose, never onConfirm", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    renderModal(onConfirm, onClose);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------- FIX-6
  it('FIX-6: with mode="generate" (first-ever generation), the modal shows the FIRST-generation copy, not the regenerate copy', () => {
    renderModal(vi.fn(), vi.fn(), "generate");
    expect(screen.getByText("Generate the onboarding tour?")).toBeInTheDocument();
    expect(
      screen.getByText(/spends one paid model call and creates the tour every member of your workspace will see/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Generate now")).toBeInTheDocument();
    // Not the regenerate-specific copy — a first generation has no existing
    // tour to "replace" yet.
    expect(screen.queryByText("Regenerate the onboarding tour?")).not.toBeInTheDocument();
    expect(screen.queryByText(/replaces the tour/i)).not.toBeInTheDocument();
  });

  it('FIX-6: with mode="generate", onConfirm is still gated behind the explicit click', () => {
    const onConfirm = vi.fn();
    renderModal(onConfirm, vi.fn(), "generate");
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Generate now"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('the "regenerate" mode copy still renders correctly when a tour already exists — the mode-prop split did not silently drop it', () => {
    renderModal(vi.fn(), vi.fn(), "regenerate");
    expect(screen.getByText("Regenerate the onboarding tour?")).toBeInTheDocument();
    expect(
      screen.getByText(/spends one paid model call, and replaces the tour every member of your workspace sees/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Regenerate now")).toBeInTheDocument();
  });
});
