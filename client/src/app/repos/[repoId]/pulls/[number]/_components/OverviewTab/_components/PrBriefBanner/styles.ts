import type { CSSProperties } from "react";

/** Co-located styles for PrBriefBanner's honest empty state — matches
 *  IntentCard/BlastRadiusCard's compact-empty-state language. */
export const s = {
  wrap: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
    padding: 18,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  emptyTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  emptyBody: {
    fontSize: 13,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
} as const;
