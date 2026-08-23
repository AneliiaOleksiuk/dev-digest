import type { CSSProperties } from "react";

export const s = {
  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 8px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    cursor: "grab",
  } satisfies CSSProperties,
  dragHandle: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  name: { fontSize: 14, fontWeight: 500, flex: 1 } satisfies CSSProperties,
} as const;
