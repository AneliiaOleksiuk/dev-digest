import type { CSSProperties } from "react";

export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } satisfies CSSProperties,
  title: { fontSize: 16, fontWeight: 700, flex: 1 } satisfies CSSProperties,
  note: { fontSize: 12, color: "var(--text-muted)", margin: 0 } satisfies CSSProperties,
  outboundNotice: { fontSize: 12, color: "var(--text-muted)", margin: 0 } satisfies CSSProperties,
  // `minmax(0, 1fr)`, not bare `1fr` — a bare `1fr` track's min-width
  // defaults to its content's min-content size, so unbreakable content in
  // the preview column (long inline code/URLs) can force the list column
  // to collapse toward its own minimum, which `wordBreak: "break-all"` on
  // `.path` lets shrink all the way to one character per line.
  layout: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
    gap: 16,
    alignItems: "start",
  } satisfies CSSProperties,
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    maxHeight: 420,
    overflowY: "auto",
  } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 8px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    cursor: "grab",
  } satisfies CSSProperties,
  dragHandle: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  path: {
    flex: 1,
    fontSize: 13,
    cursor: "pointer",
    wordBreak: "break-all",
  } satisfies CSSProperties,
  preview: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 14,
    minHeight: 200,
    fontSize: 13,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  previewPlaceholder: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  empty: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
