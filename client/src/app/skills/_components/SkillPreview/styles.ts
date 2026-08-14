import type { CSSProperties } from "react";

export const s = {
  panel: { display: "flex", flexDirection: "column", minWidth: 0 } satisfies CSSProperties,
  headerRow: { display: "flex", alignItems: "center", gap: 10, padding: "24px 24px 14px" } satisfies CSSProperties,
  title: { fontSize: 18, fontWeight: 700, flex: 1, letterSpacing: "-0.01em" } satisfies CSSProperties,
  tabsBar: { overflowX: "auto", minWidth: 0 } satisfies CSSProperties,
  content: { padding: 24 } satisfies CSSProperties,
} as const;
