import type { CSSProperties } from "react";

/** Co-located styles for StatsTab. */
export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 20, maxWidth: 820 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" } satisfies CSSProperties,
  title: { fontSize: 16, fontWeight: 700, margin: 0 } satisfies CSSProperties,
  subtitle: { fontSize: 13, color: "var(--text-secondary)", margin: "2px 0 0" } satisfies CSSProperties,
  tiles: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 } satisfies CSSProperties,
  note: { fontSize: 12, color: "var(--text-muted)", margin: 0 } satisfies CSSProperties,
  section: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  sectionTitle: { fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" } satisfies CSSProperties,
  severityRow: { display: "flex", gap: 10, flexWrap: "wrap" } satisfies CSSProperties,
  acceptRow: { display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" } satisfies CSSProperties,
  acceptValue: { fontSize: 24, fontWeight: 700 } satisfies CSSProperties,
  acceptDenominator: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  trendWrap: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    padding: 14,
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  skeletons: { display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
  // fix-loop (Row 12/AC-4) — same treatment as AgentPerformanceView's
  // `rangeIncomplete` style, for an incomplete OR invalid custom range.
  rangeNotice: {
    fontSize: 13,
    color: "var(--text-muted)",
    padding: "12px 16px",
    border: "1px dashed var(--border)",
    borderRadius: 8,
  } satisfies CSSProperties,
} as const;
