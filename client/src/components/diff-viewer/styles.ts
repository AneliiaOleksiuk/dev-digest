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
    flex: "0 1 auto",
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
    flex: "0 1 auto",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    color: "var(--text-primary)",
    maxWidth: "calc(100% - 140px)",
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

/** Full-width severity tint + thick left gutter bar (design mock). */
export function findingRowAccent(severity: string): CSSProperties {
  const color = colorForSeverity(severity);
  const tint =
    severity === "CRITICAL"
      ? "color-mix(in srgb, var(--crit, #ef4444) 22%, transparent)"
      : severity === "WARNING"
        ? "color-mix(in srgb, var(--warn, #f59e0b) 22%, transparent)"
        : severity === "SUGGESTION"
          ? "color-mix(in srgb, var(--accent, #3b82f6) 22%, transparent)"
          : "transparent";
  return {
    borderLeftWidth: 3,
    borderLeftStyle: "solid",
    borderLeftColor: color,
    // Overlay the add/del tint so the severity colour reads clearly.
    backgroundImage: `linear-gradient(${tint}, ${tint})`,
  };
}

/** Far-right severity label: icon + lowercase text, no filled pill.
 *  Horizontal placement is owned by the CodeLine wrapper (marginLeft: auto). */
export function findingTag(severity: string): CSSProperties {
  const color = colorForSeverity(severity);
  return {
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "0 2px",
    border: "none",
    borderRadius: 0,
    fontSize: 12,
    fontWeight: 500,
    textTransform: "lowercase",
    letterSpacing: "0.01em",
    color,
    background: "transparent",
    cursor: "pointer",
    lineHeight: "20px",
    whiteSpace: "nowrap",
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
  return {
    display: "flex",
    alignItems: "center",
    fontSize: 13,
    lineHeight: "20px",
    background,
    width: "100%",
    boxSizing: "border-box",
  };
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
