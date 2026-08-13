import type { CSSProperties } from "react";

/** Co-located styles for the blocked-resync refusal banner (WI10). Warn
 *  colors throughout — visually distinct from `ErrorState`'s crit-red
 *  "something went wrong" look, because a blocked resync is an instruction,
 *  not a failure (UX-15). */
export const rb = {
  banner: {
    display: "flex",
    gap: 12,
    padding: "14px 16px",
    marginBottom: 16,
    borderRadius: 8,
    border: "1px solid var(--warn)",
    background: "var(--warn-bg)",
  } satisfies CSSProperties,
  iconWrap: { color: "var(--warn)", flexShrink: 0, marginTop: 2 } satisfies CSSProperties,
  body: { display: "flex", flexDirection: "column", gap: 8, flex: 1 } satisfies CSSProperties,
  title: { fontSize: 14, fontWeight: 700, color: "var(--text-primary)" } satisfies CSSProperties,
  message: { fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 } satisfies CSSProperties,
  pathList: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: 3,
  } satisfies CSSProperties,
  path: { fontSize: 12.5, color: "var(--text-secondary)", wordBreak: "break-all" } satisfies CSSProperties,
} as const;
