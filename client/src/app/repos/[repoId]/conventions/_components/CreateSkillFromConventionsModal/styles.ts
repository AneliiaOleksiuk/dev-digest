import type { CSSProperties } from "react";

/** Co-located styles for the create-skill-from-conventions modal body. */
export const s = {
  body: { padding: "20px 24px" } satisfies CSSProperties,
  banner: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    color: "var(--text-secondary)",
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    borderRadius: 7,
    padding: "10px 12px",
    marginBottom: 20,
  } satisfies CSSProperties,
  error: { fontSize: 13, color: "var(--crit)", marginTop: -8, marginBottom: 16 } satisfies CSSProperties,
  footer: { display: "flex", justifyContent: "flex-end", gap: 10 } satisfies CSSProperties,
} as const;
