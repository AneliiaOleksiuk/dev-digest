import type { CSSProperties } from "react";

/** Co-located styles for BlastRadiusCard — matches IntentCard's honest
 *  compact-empty-state language (client/INSIGHTS.md Codebase Patterns). */
export const s = {
  wrap: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  cardTitle: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  } satisfies CSSProperties,
  cardTitleText: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
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
    maxWidth: 420,
  } satisfies CSSProperties,
} as const;
