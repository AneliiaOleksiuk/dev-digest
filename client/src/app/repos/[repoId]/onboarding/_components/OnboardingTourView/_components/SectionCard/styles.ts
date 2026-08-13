import type { CSSProperties } from "react";

export const s = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    overflow: "hidden",
  } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "12px 14px",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
  } satisfies CSSProperties,
  chevron: { flexShrink: 0, transition: "transform .12s" } satisfies CSSProperties,
  title: { fontSize: 14, fontWeight: 650, color: "var(--text-primary)", flex: 1 } satisfies CSSProperties,
  body: { padding: "0 14px 16px", fontSize: 13.5, color: "var(--text-secondary)" } satisfies CSSProperties,
  fallback: { fontSize: 13, color: "var(--text-muted)", fontStyle: "italic" } satisfies CSSProperties,
  links: { display: "flex", flexDirection: "column", gap: 6, marginTop: 10 } satisfies CSSProperties,
  link: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12.5,
    color: "var(--accent-text)",
    textDecoration: "none",
  } satisfies CSSProperties,
} as const;
