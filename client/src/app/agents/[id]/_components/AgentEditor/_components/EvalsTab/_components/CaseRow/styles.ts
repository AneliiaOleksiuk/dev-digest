import type { CSSProperties } from "react";

/** Co-located styles for CaseRow. */
export const s = {
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    flexWrap: "wrap",
  } satisfies CSSProperties,
  main: { display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 } satisfies CSSProperties,
  name: { fontSize: 14, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  muted: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  passed: { fontSize: 12, fontWeight: 600, color: "var(--ok)" } satisfies CSSProperties,
  failed: { fontSize: 12, fontWeight: 600, color: "var(--crit)" } satisfies CSSProperties,
  actions: { display: "flex", gap: 6, flexShrink: 0 } satisfies CSSProperties,
} as const;
