import type { CSSProperties } from "react";

/** Co-located styles for CaseEditorModal. */
export const s = {
  body: { padding: 24, display: "flex", flexDirection: "column", gap: 4 } satisfies CSSProperties,
  badgeRow: { display: "flex", alignItems: "center", gap: 8, marginTop: -12, marginBottom: 16 } satisfies CSSProperties,
  resultSummary: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  footer: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 } satisfies CSSProperties,
  footerRight: { display: "flex", gap: 8, marginLeft: "auto" } satisfies CSSProperties,
} as const;
