import type { CSSProperties } from "react";

export const s = {
  body: { display: "flex", flexDirection: "column", gap: 16, paddingTop: 16 } satisfies CSSProperties,
  error: { fontSize: 13, color: "var(--crit)" } satisfies CSSProperties,
  actions: { display: "flex", justifyContent: "flex-end" } satisfies CSSProperties,
} as const;
