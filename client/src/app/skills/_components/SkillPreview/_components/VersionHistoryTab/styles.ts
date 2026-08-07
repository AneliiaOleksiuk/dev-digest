import type { CSSProperties } from "react";

export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 6, maxHeight: 200, overflow: "auto" } satisfies CSSProperties,
  item: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "transparent",
    cursor: "pointer",
    textAlign: "left",
  } satisfies CSSProperties,
  itemActive: { borderColor: "var(--accent)", background: "var(--bg-elevated)" } satisfies CSSProperties,
  meta: { fontSize: 12, color: "var(--text-secondary)" } satisfies CSSProperties,
  body: {
    fontSize: 14,
    lineHeight: 1.6,
    padding: 16,
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    maxHeight: 400,
    overflow: "auto",
  } satisfies CSSProperties,
  empty: { fontSize: 13, color: "var(--text-secondary)", padding: "8px 0" } satisfies CSSProperties,
} as const;
