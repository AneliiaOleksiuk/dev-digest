import type { CSSProperties } from "react";

/** Co-located styles for the new-document creation dialog (WI9). */
export const nd = {
  form: { display: "flex", flexDirection: "column", gap: 14, padding: 20 } satisfies CSSProperties,
  field: { display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  label: { fontSize: 12.5, fontWeight: 600, color: "var(--text-secondary)" } satisfies CSSProperties,
  pathRow: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  pathRoot: { flexShrink: 0, width: 140 } satisfies CSSProperties,
  pathSep: { color: "var(--text-muted)", fontSize: 14 } satisfies CSSProperties,
  pathRelative: { flex: 1 } satisfies CSSProperties,
  suffix: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  notice: {
    fontSize: 12,
    color: "var(--text-muted)",
    borderTop: "1px solid var(--border)",
    paddingTop: 10,
  } satisfies CSSProperties,
  error: {
    fontSize: 13,
    color: "var(--crit)",
    background: "var(--crit-bg)",
    border: "1px solid var(--crit)",
    borderRadius: 6,
    padding: "8px 10px",
  } satisfies CSSProperties,
  footer: { display: "flex", justifyContent: "flex-end", gap: 8 } satisfies CSSProperties,
} as const;
