import type { CSSProperties } from "react";

/** Co-located styles for CiTab. */
export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 20, maxWidth: 820 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  title: { fontSize: 16, fontWeight: 700, flex: 1 } satisfies CSSProperties,
  subtitle: { fontSize: 13, color: "var(--text-secondary)", margin: "-8px 0 0" } satisfies CSSProperties,
  section: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  sectionTitle: { fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" } satisfies CSSProperties,
  failOnRow: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } satisfies CSSProperties,
  failOnSelectWrap: { minWidth: 240 } satisfies CSSProperties,
  note: { fontSize: 12, color: "var(--text-muted)", margin: 0, lineHeight: 1.5 } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  row: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: 14,
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  rowHead: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } satisfies CSSProperties,
  repo: { fontSize: 14, fontWeight: 600 } satisfies CSSProperties,
  rowMeta: { fontSize: 12, color: "var(--text-muted)", marginLeft: "auto" } satisfies CSSProperties,
  driftBanner: {
    fontSize: 12,
    color: "var(--warn)",
    background: "var(--warn-bg)",
    borderRadius: 6,
    padding: "6px 10px",
  } satisfies CSSProperties,
  rowActions: { display: "flex", gap: 8 } satisfies CSSProperties,
} as const;
