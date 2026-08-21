import type { CSSProperties } from "react";

/** Co-located styles for AgentEvalDetail. */
export const s = {
  page: { padding: "24px 28px 48px", display: "flex", flexDirection: "column", gap: 20 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 12 } satisfies CSSProperties,
  h1: { fontSize: 20, fontWeight: 700, margin: 0, flex: 1 } satisfies CSSProperties,
  metricsRow: { display: "flex", gap: 12 } satisfies CSSProperties,
  metricWrap: { flex: 1, display: "flex", flexDirection: "column", gap: 4 } satisfies CSSProperties,
  naNote: { fontSize: 11, color: "var(--text-muted)", margin: 0 } satisfies CSSProperties,
  note: {
    fontSize: 12,
    color: "var(--text-muted)",
    margin: 0,
    lineHeight: 1.5,
    borderLeft: "2px solid var(--border-strong)",
    paddingLeft: 10,
  } satisfies CSSProperties,
  chartCaption: { fontSize: 11, color: "var(--text-muted)", margin: "6px 0 0" } satisfies CSSProperties,
  sectionTitle: { fontSize: 15, fontWeight: 700, margin: "0 0 10px" } satisfies CSSProperties,
  table: { width: "100%", borderCollapse: "collapse" as const, fontSize: 13 } satisfies CSSProperties,
  th: {
    textAlign: "left" as const,
    fontSize: 11,
    color: "var(--text-muted)",
    fontWeight: 600,
    padding: "6px 10px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  td: { padding: "8px 10px", borderBottom: "1px solid var(--border)", verticalAlign: "middle" as const } satisfies CSSProperties,
  rowSelectable: { cursor: "pointer" } satisfies CSSProperties,
  rowSelected: { background: "var(--bg-hover)" } satisfies CSSProperties,
  compareBar: { display: "flex", alignItems: "center", gap: 10, marginTop: 10 } satisfies CSSProperties,
} as const;
