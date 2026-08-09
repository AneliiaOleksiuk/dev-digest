import type { CSSProperties } from "react";

export const s = {
  panel: { display: "flex", flexDirection: "column", maxWidth: 640 } satisfies CSSProperties,
  headerRow: { display: "flex", alignItems: "center", gap: 10, padding: "24px 24px 14px" } satisfies CSSProperties,
  title: { fontSize: 18, fontWeight: 700, flex: 1, letterSpacing: "-0.01em" } satisfies CSSProperties,
  content: { padding: 24 } satisfies CSSProperties,
} as const;
