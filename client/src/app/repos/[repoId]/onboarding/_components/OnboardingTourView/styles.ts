import type { CSSProperties } from "react";

/** Co-located styles for the Onboarding Tour page. */
export const s = {
  page: { padding: "24px 32px 44px", maxWidth: 900, margin: "0 auto" } satisfies CSSProperties,
  header: { marginBottom: 16, display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  headerTop: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  h1: { fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  actions: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } satisfies CSSProperties,
  metaRow: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } satisfies CSSProperties,
  metaText: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  costRow: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } satisfies CSSProperties,
  costText: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  statusRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } satisfies CSSProperties,
  statusText: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  resyncNote: { fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 } satisfies CSSProperties,
  loadingStack: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  sectionList: { display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
} as const;
