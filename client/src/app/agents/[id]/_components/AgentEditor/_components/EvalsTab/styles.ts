import type { CSSProperties } from "react";

/** Co-located styles for EvalsTab. */
export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 20, maxWidth: 760 } satisfies CSSProperties,
  title: { fontSize: 16, fontWeight: 700, margin: 0 } satisfies CSSProperties,
  subtitle: { fontSize: 13, color: "var(--text-secondary)", margin: "2px 0 0" } satisfies CSSProperties,
  metricsRow: { display: "flex", gap: 12 } satisfies CSSProperties,
  metricWrap: { flex: 1, display: "flex", flexDirection: "column", gap: 4 } satisfies CSSProperties,
  naNote: { fontSize: 11, color: "var(--text-muted)", margin: 0, lineHeight: 1.4 } satisfies CSSProperties,
  relativeNote: {
    fontSize: 12,
    color: "var(--text-muted)",
    margin: 0,
    lineHeight: 1.5,
    borderLeft: "2px solid var(--border-strong)",
    paddingLeft: 10,
  } satisfies CSSProperties,
  firstRunNote: { fontSize: 12, color: "var(--text-muted)", margin: 0 } satisfies CSSProperties,
  casesHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  casesHeaderActions: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } satisfies CSSProperties,
  estimate: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
} as const;
