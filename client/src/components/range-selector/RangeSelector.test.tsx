/**
 * RangeSelector — regression tests pinning the fix-loop bug documented at
 * RangeSelector.tsx:48-63: a controlled `<input type="date">` bound directly
 * to a URL-derived `value` prop was resetting mid-keystroke because
 * `onChange` round-tripped through `router.replace()` (→ new `value` prop)
 * on EVERY change event, including the browser's own transitional/incomplete
 * date events.
 *
 * Oracle (derived from the parent orchestrator's task description of the
 * production bug and its fix, BEFORE reading beyond RangeSelector.tsx's
 * wiring facts — props/labels/aria-labels):
 *   1. A partial/incomplete date event (browser reports "" while a segment
 *      is still being typed) must NOT call `onChange`.
 *   2. A complete date event calls `onChange` exactly once (not once per
 *      keystroke/transitional event).
 *   3. An external `value` prop change (e.g. parent resets the range via the
 *      URL) re-syncs the input's displayed value.
 *   4. A deliberate clear (blur with an empty value on a field that had a
 *      value) propagates `undefined` for that field via `onChange`; a blur
 *      on an already-empty field is a no-op (no spurious `onChange`).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { RangeQuery } from "@/lib/hooks/range";
import { RangeSelector, type RangeSelectorLabels } from "./RangeSelector";

afterEach(() => {
  cleanup();
});

const labels: RangeSelectorLabels = {
  "1d": "1 day",
  "30d": "30 days",
  custom: "Custom",
  customFrom: "From",
  customTo: "To",
};

function renderSelector(value: RangeQuery, onChange: (next: RangeQuery) => void) {
  return render(<RangeSelector value={value} onChange={onChange} labels={labels} />);
}

describe("RangeSelector — custom date inputs (controlled-vs-local state contract)", () => {
  it("does not call onChange while a date is only partially typed", () => {
    const onChange = vi.fn();
    renderSelector({ range: "custom", start: undefined, end: undefined }, onChange);
    const fromInput = screen.getByLabelText("From") as HTMLInputElement;

    // A native date input reports an empty string for every transitional
    // keystroke while a segment (year/month/day) is incomplete.
    fireEvent.change(fromInput, { target: { value: "" } });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("calls onChange exactly once when a complete date is entered, not per transitional keystroke", () => {
    const onChange = vi.fn();
    renderSelector({ range: "custom", start: undefined, end: "2026-08-20" }, onChange);
    const fromInput = screen.getByLabelText("From") as HTMLInputElement;

    // Simulate the browser's transitional empty events while typing, then
    // the final, complete date.
    fireEvent.change(fromInput, { target: { value: "" } });
    fireEvent.change(fromInput, { target: { value: "" } });
    fireEvent.change(fromInput, { target: { value: "2026-08-15" } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ range: "custom", start: "2026-08-15", end: "2026-08-20" });
  });

  it("re-syncs the input's displayed value when the value prop changes externally", () => {
    const onChange = vi.fn();
    const { rerender } = renderSelector(
      { range: "custom", start: "2026-08-01", end: "2026-08-02" },
      onChange,
    );
    const fromInput = screen.getByLabelText("From") as HTMLInputElement;
    expect(fromInput.value).toBe("2026-08-01");

    // Parent (e.g. URL/back-forward navigation) resets the range externally.
    rerender(<RangeSelector value={{ range: "custom", start: "2026-09-10", end: "2026-08-02" }} onChange={onChange} labels={labels} />);

    expect(fromInput.value).toBe("2026-09-10");
  });

  it("propagates undefined on a deliberate clear (blur with empty value), and is a no-op on blur of an already-empty field", () => {
    const onChange = vi.fn();
    renderSelector({ range: "custom", start: "2026-08-01", end: "2026-08-02" }, onChange);
    const fromInput = screen.getByLabelText("From") as HTMLInputElement;

    // Deliberate clear: user empties the field (native "x" / select-all-
    // delete), then leaves it.
    fireEvent.blur(fromInput, { target: { value: "" } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ range: "custom", start: undefined, end: "2026-08-02" });
    expect(fromInput.value).toBe("");

    // Blurring an already-empty field must not fire a spurious onChange.
    onChange.mockClear();
    fireEvent.blur(fromInput, { target: { value: "" } });
    expect(onChange).not.toHaveBeenCalled();
  });
});
