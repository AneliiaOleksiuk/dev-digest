/* RangeSelector — 1d / 30d / custom range picker (SPEC-06). A new reusable
   UI primitive, so it lives here per client/INSIGHTS.md's convention
   ("new reusable UI primitives do NOT go in src/vendor/ui/**") rather than
   as vendored design-system code. Shared by the Agent Editor's Stats tab and
   the Agent Performance dashboard (AC-6: both surfaces reflect the range in
   the URL as `?range=`). Presentation-only — the two callers pass their own
   already-translated labels, since they read from different i18n namespaces
   (`agents` vs `agentPerformance`). */
"use client";

import React from "react";
import { SelectInput } from "@devdigest/ui";
import type { RangeMode, RangeQuery } from "@/lib/hooks/range";

export interface RangeSelectorLabels {
  "1d": string;
  "30d": string;
  custom: string;
  customFrom: string;
  customTo: string;
}

const inputStyle: React.CSSProperties = {
  background: "var(--bg-elevated)",
  color: "var(--text-primary)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "6px 10px",
  fontSize: 13,
};

export function RangeSelector({
  value,
  onChange,
  labels,
}: {
  value: RangeQuery;
  onChange: (next: RangeQuery) => void;
  labels: RangeSelectorLabels;
}) {
  const mode: RangeMode = value.range ?? "30d";
  const options = [
    { value: "1d", label: labels["1d"] },
    { value: "30d", label: labels["30d"] },
    { value: "custom", label: labels.custom },
  ];

  // fix-loop — LOCAL state for the two date inputs, decoupled from the
  // `value` prop (which round-trips through the URL on every commit). Root
  // cause of the reported bugs ("calendar icon does nothing" / "can't finish
  // typing a full date, year segment never sticks"): this component used to
  // bind the native <input type="date">'s `value` DIRECTLY to `value.start`/
  // `value.end` and call the parent's `onChange` (→ router.replace → new
  // URL → new `value` prop) on EVERY change event, including the browser's
  // own transitional/incomplete-date events while the user is still
  // mid-typing a segment. Each such round trip re-rendered this component
  // with a stale or empty `value.start`/`value.end`, forcing React to reset
  // the controlled input's DOM value out from under the user — wiping
  // already-typed segments and interrupting the native date picker.
  // Fix: keep the input controlled by LOCAL state, and only propagate
  // upward (which triggers the URL/fetch round trip) once the browser
  // reports a genuinely complete date (a non-empty `e.target.value` — a
  // native date input only reports non-empty once every segment is valid).
  const [localStart, setLocalStart] = React.useState(value.start ?? "");
  const [localEnd, setLocalEnd] = React.useState(value.end ?? "");

  // Re-sync from an EXTERNAL change only (browser back/forward, or another
  // surface changing the URL) — safe because our own commits below already
  // match local state by the time they round-trip back down as props.
  React.useEffect(() => {
    setLocalStart(value.start ?? "");
  }, [value.start]);
  React.useEffect(() => {
    setLocalEnd(value.end ?? "");
  }, [value.end]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <div style={{ minWidth: 150 }}>
        <SelectInput
          value={mode}
          onChange={(v) => {
            if (v === "custom") onChange({ range: "custom", start: value.start, end: value.end });
            else onChange({ range: v as RangeMode });
          }}
          options={options}
        />
      </div>
      {mode === "custom" && (
        <>
          <input
            type="date"
            aria-label={labels.customFrom}
            value={localStart}
            onChange={(e) => {
              const v = e.target.value;
              // Only a COMPLETE date is ever non-empty here — ignore the
              // browser's transitional empty value while segments are still
              // being typed, so local state (and the controlled DOM value)
              // never gets forced back to "" mid-edit.
              if (v) {
                setLocalStart(v);
                onChange({ range: "custom", start: v, end: value.end });
              }
            }}
            onBlur={(e) => {
              // A deliberate clear (native "x" button / select-all-delete,
              // THEN leaving the field) — propagate it, but never on an
              // in-progress partial edit (blur only fires once, not per
              // keystroke).
              if (!e.target.value && localStart) {
                setLocalStart("");
                onChange({ range: "custom", start: undefined, end: value.end });
              }
            }}
            style={inputStyle}
          />
          <span style={{ color: "var(--text-muted)" }}>–</span>
          <input
            type="date"
            aria-label={labels.customTo}
            value={localEnd}
            onChange={(e) => {
              const v = e.target.value;
              if (v) {
                setLocalEnd(v);
                onChange({ range: "custom", start: value.start, end: v });
              }
            }}
            onBlur={(e) => {
              if (!e.target.value && localEnd) {
                setLocalEnd("");
                onChange({ range: "custom", start: value.start, end: undefined });
              }
            }}
            style={inputStyle}
          />
        </>
      )}
    </div>
  );
}
