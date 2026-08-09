import type { CSSProperties } from "react";

/** Co-located styles for a single convention candidate card. */
export const s = {
  card: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  headerRow: { display: "flex", alignItems: "flex-start", gap: 12 } satisfies CSSProperties,
  ruleColumn: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  badgeRow: { display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" } satisfies CSSProperties,
  rule: { fontSize: 14, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  evidence: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
    fontFamily: "var(--font-mono, monospace)",
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    padding: "8px 10px",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  } satisfies CSSProperties,
  evidencePath: { color: "var(--text-muted)", marginBottom: 4, display: "block" } satisfies CSSProperties,
  evidenceLink: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
    fontFamily: "var(--font-mono, monospace)",
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    padding: "8px 10px",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    display: "block",
    textDecoration: "none",
    cursor: "pointer",
  } satisfies CSSProperties,
  evidenceLinkIcon: { marginLeft: 6, verticalAlign: "middle", color: "var(--accent)" } satisfies CSSProperties,
  actions: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    flexShrink: 0,
  } satisfies CSSProperties,
  footerRow: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  confidenceLabel: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  confidenceBar: { flex: 1, maxWidth: 160 } satisfies CSSProperties,
  cardAccepted: {
    borderLeft: "3px solid var(--ok)",
  } satisfies CSSProperties,
  cardNeutral: {
    borderLeft: "3px solid transparent",
  } satisfies CSSProperties,
  cardRejected: {
    borderLeft: "3px solid var(--text-muted)",
    opacity: 0.6,
  } satisfies CSSProperties,
} as const;
