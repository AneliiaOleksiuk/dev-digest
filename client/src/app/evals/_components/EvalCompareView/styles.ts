import type { CSSProperties } from "react";

/** Co-located styles for EvalCompareView. */
export const s = {
  page: { padding: "24px 28px 48px", display: "flex", flexDirection: "column", gap: 20 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 12 } satisfies CSSProperties,
  h1: { fontSize: 20, fontWeight: 700, margin: 0, flex: 1 } satisfies CSSProperties,
  note: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  columns: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 20 } satisfies CSSProperties,
  column: { display: "flex", flexDirection: "column", gap: 10, border: "1px solid var(--border)", borderRadius: 8, padding: 16 } satisfies CSSProperties,
  columnLabel: { fontSize: 12, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.04em", textTransform: "uppercase" as const } satisfies CSSProperties,
  metaRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  metricsRow: { display: "flex", gap: 10 } satisfies CSSProperties,
  metric: { flex: 1, textAlign: "center" as const, padding: "8px 4px", borderRadius: 6, background: "var(--bg-elevated)" } satisfies CSSProperties,
  metricLabel: { fontSize: 10, color: "var(--text-muted)" } satisfies CSSProperties,
  metricValue: { fontSize: 15, fontWeight: 700 } satisfies CSSProperties,
  promptTitle: { fontSize: 12, fontWeight: 700, color: "var(--text-secondary)", marginTop: 6 } satisfies CSSProperties,
  prompt: {
    fontSize: 12,
    lineHeight: 1.5,
    whiteSpace: "pre-wrap" as const,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    padding: 10,
    maxHeight: 260,
    overflow: "auto",
    fontFamily: "var(--font-mono, monospace)",
  } satisfies CSSProperties,
  deltaBar: { display: "flex", gap: 16, flexWrap: "wrap" } satisfies CSSProperties,
  deltaTile: { display: "flex", flexDirection: "column", alignItems: "center", gap: 2 } satisfies CSSProperties,
  deltaLabel: { fontSize: 11, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
