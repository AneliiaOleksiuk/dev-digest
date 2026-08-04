import type { CSSProperties } from "react";

/** Co-located styles for the Conventions list page. */
export const s = {
  page: { padding: "24px 32px 44px", maxWidth: 900, margin: "0 auto" } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "flex-end",
    gap: 16,
    marginBottom: 20,
  } satisfies CSSProperties,
  headerText: { flex: 1 } satisfies CSSProperties,
  h1: { fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  subtitle: { fontSize: 14, color: "var(--text-secondary)", marginTop: 4 } satisfies CSSProperties,
  loadingStack: { display: "flex", flexDirection: "column", gap: 14 } satisfies CSSProperties,
  candidateCount: {
    fontSize: 13,
    color: "var(--text-secondary)",
    margin: "0 0 14px",
  } satisfies CSSProperties,
  toolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
    padding: "0 2px 14px",
  } satisfies CSSProperties,
  toolbarLeft: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  } satisfies CSSProperties,
  acceptedOf: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
  mutationError: {
    fontSize: 13,
    color: "var(--crit)",
    background: "var(--crit-bg)",
    border: "1px solid var(--crit)",
    borderRadius: 7,
    padding: "10px 12px",
    marginBottom: 14,
  } satisfies CSSProperties,
} as const;
