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
            value={value.start ?? ""}
            onChange={(e) => onChange({ range: "custom", start: e.target.value, end: value.end })}
            style={inputStyle}
          />
          <span style={{ color: "var(--text-muted)" }}>–</span>
          <input
            type="date"
            aria-label={labels.customTo}
            value={value.end ?? ""}
            onChange={(e) => onChange({ range: "custom", start: value.start, end: e.target.value })}
            style={inputStyle}
          />
        </>
      )}
    </div>
  );
}
