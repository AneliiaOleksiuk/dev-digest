import type { CSSProperties } from "react";
import { SEV } from "@devdigest/ui";
import type { Line } from "./helpers";

/** Color for a finding's severity (falls back to muted for an unknown value). */
function colorForSeverity(severity: string): string {
  return SEV[severity as keyof typeof SEV]?.c ?? "var(--text-muted)";
}

/** Co-located styles for the DiffViewer (extracted from inline styles). */
export const s = {
  list: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  empty: { padding: "24px", fontSize: 14, color: "var(--text-muted)", textAlign: "center" } satisfies CSSProperties,
  fileCard: {
    border: "1px solid var(--border)",
    borderRadius: 7,
    overflow: "hidden",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  fileHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    cursor: "pointer",
  } satisfies CSSProperties,
  fileIcon: { color: "var(--text-muted)" } satisfies CSSProperties,
  filePath: {
    fontSize: 13,
    fontWeight: 500,
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  fileStat: { fontSize: 12 } satisfies CSSProperties,
  addText: { color: "var(--code-add-text)" } satisfies CSSProperties,
  delText: { color: "var(--code-del-text)" } satisfies CSSProperties,
  fileBody: {
    borderTop: "1px solid var(--border)",
    padding: "8px 0",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  noDiff: {
    padding: "14px 18px",
    fontSize: 13,
    color: "var(--text-muted)",
    textAlign: "center",
  } satisfies CSSProperties,
  hunk: {
    fontSize: 12,
    lineHeight: "20px",
    color: "var(--accent-text)",
    background: "var(--accent-bg)",
    padding: "0 14px",
  } satisfies CSSProperties,
  lineNo: {
    width: 44,
    textAlign: "right",
    padding: "0 10px 0 0",
    color: "var(--text-muted)",
    userSelect: "none",
    flexShrink: 0,
  } satisfies CSSProperties,
  lineText: {
    flex: 1,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    color: "var(--text-primary)",
    paddingRight: 12,
  } satisfies CSSProperties,
  findingPopoverPanel: { width: 320, padding: 6 } satisfies CSSProperties,
  findingPopoverList: { display: "flex", flexDirection: "column", gap: 2 } satisfies CSSProperties,
  findingPopoverRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    width: "100%",
    padding: 8,
    borderRadius: 6,
    border: "none",
    background: "transparent",
    textAlign: "left",
    cursor: "pointer",
  } satisfies CSSProperties,
  findingPopoverRowMain: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  findingPopoverTitle: { fontSize: 13, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  findingPopoverRationale: {
    marginTop: 3,
    fontSize: 12,
    lineHeight: 1.4,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  findingPopoverJump: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: 600,
    color: "var(--accent-text)",
  } satisfies CSSProperties,
} as const;

/** Left-border accent on a diff line covered by a finding, colored by severity. */
export function findingRowAccent(severity: string): CSSProperties {
  const color = colorForSeverity(severity);
  return { borderLeftWidth: 3, borderLeftStyle: "solid", borderLeftColor: color };
}

/** Small inline severity tag ("blocker"/"warning"/…) at the end of a covered line. */
export function findingTag(severity: string): CSSProperties {
  const color = colorForSeverity(severity);
  return {
    flexShrink: 0,
    alignSelf: "center",
    marginRight: 10,
    padding: "2px 8px",
    borderRadius: 5,
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color,
    background: "var(--bg-hover)",
    cursor: "pointer",
  };
}

/** Chevron rotates 90deg when the file card is open. */
export function chevronFor(open: boolean): CSSProperties {
  return {
    color: "var(--text-muted)",
    transform: open ? "rotate(90deg)" : "none",
    transition: "transform .12s",
  };
}

/** Row background per line kind (add/del tinted, others transparent). */
export function lineRowFor(kind: Line["kind"]): CSSProperties {
  const background = kind === "add" ? "var(--code-add)" : kind === "del" ? "var(--code-del)" : "transparent";
  return { display: "flex", alignItems: "stretch", fontSize: 13, lineHeight: "20px", background };
}

/** Gutter sign colour per line kind. */
export function lineSignFor(kind: Line["kind"]): CSSProperties {
  return {
    width: 14,
    textAlign: "center",
    color: kind === "add" ? "var(--code-add-text)" : kind === "del" ? "var(--code-del-text)" : "var(--text-muted)",
    flexShrink: 0,
  };
}
