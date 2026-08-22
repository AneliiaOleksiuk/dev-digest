import type { CSSProperties } from "react";

/** Co-located styles for EvalDashboardView. */
export const s = {
  page: { padding: "24px 28px 48px", display: "flex", flexDirection: "column", gap: 20 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" } satisfies CSSProperties,
  h1: { fontSize: 20, fontWeight: 700, margin: 0 } satisfies CSSProperties,
  headerActions: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 } satisfies CSSProperties,
  estimate: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  autoNote: { fontSize: 11, color: "var(--text-muted)", maxWidth: 280, textAlign: "right" } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  row: { display: "flex", alignItems: "center", gap: 16 } satisfies CSSProperties,
  rowMain: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 } satisfies CSSProperties,
  rowName: { fontSize: 15, fontWeight: 600 } satisfies CSSProperties,
  rowMeta: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  rowMetrics: { display: "flex", gap: 18, alignItems: "center" } satisfies CSSProperties,
  rowMetric: { display: "flex", flexDirection: "column", alignItems: "center", gap: 2, minWidth: 56 } satisfies CSSProperties,
  rowMetricLabel: { fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.04em" } satisfies CSSProperties,
  rowMetricValue: { fontSize: 15, fontWeight: 700 } satisfies CSSProperties,
} as const;
