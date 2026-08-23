import type { CSSProperties } from "react";

/** Co-located styles for the Preview/Edit panel (WI8). */
export const ds = {
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 10,
    paddingBottom: 10,
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  headerLeft: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 } satisfies CSSProperties,
  path: { fontSize: 13, color: "var(--text-secondary)", wordBreak: "break-all" } satisfies CSSProperties,
  dirtyDot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "var(--warn)",
    flexShrink: 0,
  } satisfies CSSProperties,
  body: { fontSize: 14, lineHeight: 1.55 } satisfies CSSProperties,
  editStack: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  writeNotice: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  banner: {
    fontSize: 13,
    color: "var(--crit)",
    background: "var(--crit-bg)",
    border: "1px solid var(--crit)",
    borderRadius: 6,
    padding: "8px 10px",
  } satisfies CSSProperties,
  actions: { display: "flex", justifyContent: "flex-end", gap: 8 } satisfies CSSProperties,
  placeholder: { fontSize: 14, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
