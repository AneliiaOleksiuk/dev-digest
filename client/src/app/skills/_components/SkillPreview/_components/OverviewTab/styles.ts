import type { CSSProperties } from "react";

export const s = {
  untrustedNotice: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: 12,
    borderRadius: 8,
    border: "1px solid var(--warn-bg)",
    background: "var(--warn-bg)",
    marginBottom: 16,
  } satisfies CSSProperties,
  untrustedText: { fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5, margin: 0 } satisfies CSSProperties,
  row: { display: "flex", alignItems: "center", gap: 10, marginBottom: 16 } satisfies CSSProperties,
  rowLabel: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  body: {
    fontSize: 14,
    lineHeight: 1.6,
    padding: 16,
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    marginBottom: 16,
    maxHeight: 480,
    overflow: "auto",
  } satisfies CSSProperties,
  actions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 } satisfies CSSProperties,
  error: { fontSize: 13, color: "var(--crit)" } satisfies CSSProperties,
} as const;
