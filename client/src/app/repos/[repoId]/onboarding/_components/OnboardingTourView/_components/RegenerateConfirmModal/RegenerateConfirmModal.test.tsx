/**
 * RegenerateConfirmModal (WI12) — Regenerate confirmation gate.
 *
 * Oracle (derived BEFORE reading the component): AC-6 ("the system shall
 * require an explicit confirmation before issuing the call, and that
 * confirmation shall state both consequences: one model call is spent, and
 * the tour every member of the workspace sees is replaced", D-14, E-13) and
 * WI12's DoD ("a component test exists asserting the generate request is NOT
 * issued until the confirmation is accepted, and that the confirmation text
 * names both consequences").
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import onboardingMessages from "../../../../../../../../../messages/en/onboarding.json";

import { RegenerateConfirmModal } from "./RegenerateConfirmModal";

afterEach(cleanup);

function renderModal(onConfirm: () => void, onClose: () => void) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: onboardingMessages }}>
      <RegenerateConfirmModal onConfirm={onConfirm} onClose={onClose} />
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
});
