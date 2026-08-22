import type { CSSProperties } from "react";

/** Co-located styles for CiRunsView. */
export const s = {
  page: { padding: "24px 28px 48px", display: "flex", flexDirection: "column", gap: 20 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" } satisfies CSSProperties,
  headerText: { display: "flex", flexDirection: "column", gap: 2 } satisfies CSSProperties,
  h1: { fontSize: 20, fontWeight: 700, margin: 0 } satisfies CSSProperties,
  subtitle: { fontSize: 13, color: "var(--text-secondary)", margin: 0 } satisfies CSSProperties,
  filters: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" } satisfies CSSProperties,
  filterWrap: { minWidth: 160 } satisfies CSSProperties,
  tableWrap: { overflowX: "auto", border: "1px solid var(--border)", borderRadius: 8 } satisfies CSSProperties,
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 } satisfies CSSProperties,
  th: {
    textAlign: "left",
    padding: "10px 12px",
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-muted)",
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  td: {
    padding: "10px 12px",
    borderBottom: "1px solid var(--border)",
    verticalAlign: "top",
  } satisfies CSSProperties,
  prCell: { display: "flex", flexDirection: "column", gap: 2, maxWidth: 320 } satisfies CSSProperties,
  prNumber: { fontWeight: 600 } satisfies CSSProperties,
  prTitle: {
    color: "var(--text-secondary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  findingsCell: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" } satisfies CSSProperties,
  severityChip: { fontSize: 12, fontWeight: 600 } satisfies CSSProperties,
  muted: { color: "var(--text-muted)" } satisfies CSSProperties,
  linkCell: { display: "flex", justifyContent: "flex-end" } satisfies CSSProperties,
} as const;
