import type { CSSProperties } from "react";

export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 12, maxWidth: 640 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  title: { fontSize: 16, fontWeight: 700, flex: 1 } satisfies CSSProperties,
  filterInput: {
    padding: "8px 12px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    fontSize: 13,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  orderHint: { fontSize: 12, color: "var(--text-muted)", margin: 0 } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 2 } satisfies CSSProperties,
} as const;
