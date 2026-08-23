import type { CSSProperties } from "react";

/* BlastPanel styles — inline stats + header toggle (mock parity), collapsible
   symbol groups, prior-PRs section. */
export const s = {
  headerRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  toggleRow: {
    display: "flex",
    justifyContent: "flex-end",
    marginBottom: 12,
  } satisfies CSSProperties,
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  } satisfies CSSProperties,
  viewToggle: {
    display: "flex",
    border: "1px solid var(--border)",
    borderRadius: 6,
    overflow: "hidden",
    flexShrink: 0,
  } satisfies CSSProperties,
  viewBtn: {
    background: "none",
    border: "none",
    padding: "4px 10px",
    fontSize: 12,
    cursor: "pointer",
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  viewBtnActive: {
    background: "var(--bg-hover)",
    color: "var(--text-primary)",
    fontWeight: 600,
  } satisfies CSSProperties,

  statLine: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 4,
    fontSize: 12,
    color: "var(--text-secondary)",
    minWidth: 0,
  } satisfies CSSProperties,
  statInlineItem: {
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  statInlineValue: {
    fontWeight: 700,
    color: "var(--text-primary)",
    fontVariantNumeric: "tabular-nums",
  } satisfies CSSProperties,
  statDot: {
    color: "var(--text-muted)",
    margin: "0 2px",
  } satisfies CSSProperties,
  statValueMuted: {
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  banner: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 6,
    border: "1px solid var(--warn)",
    background: "var(--warn-bg)",
    color: "var(--warn)",
    fontSize: 13,
    lineHeight: 1.45,
    marginBottom: 16,
  } satisfies CSSProperties,
  bannerText: { flex: 1, minWidth: 0, color: "var(--text-secondary)" } satisfies CSSProperties,
  bannerTitle: { fontWeight: 600, color: "var(--text-primary)", marginBottom: 2 } satisfies CSSProperties,

  empty: {
    fontSize: 13,
    color: "var(--text-muted)",
    fontStyle: "italic",
    padding: "8px 0",
  } satisfies CSSProperties,

  tree: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    minWidth: 0,
  } satisfies CSSProperties,
  symbolGroup: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 12,
    minWidth: 0,
    overflow: "hidden",
  } satisfies CSSProperties,
  symbolHeaderBtn: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    minWidth: 0,
    background: "none",
    border: "none",
    padding: 0,
    cursor: "pointer",
    textAlign: "left",
    color: "inherit",
  } satisfies CSSProperties,
  symbolName: {
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: 13,
    fontWeight: 700,
    color: "var(--text-primary)",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  callerList: {
    listStyle: "none",
    margin: 0,
    marginTop: 8,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    minWidth: 0,
  } satisfies CSSProperties,
  callerRow: {
    display: "block",
    minWidth: 0,
    fontSize: 13,
  } satisfies CSSProperties,
  /** Constrains MonoLink (inline) so long file:line paths wrap inside the card. */
  callerPath: {
    display: "block",
    minWidth: 0,
    maxWidth: "100%",
    overflowWrap: "anywhere",
    wordBreak: "break-all",
  } satisfies CSSProperties,
  factsRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 10,
    paddingTop: 10,
    borderTop: "1px solid var(--border)",
    minWidth: 0,
  } satisfies CSSProperties,
  /** Override Badge's whiteSpace:nowrap so long endpoint templates wrap. */
  factBadge: {
    maxWidth: "100%",
    whiteSpace: "normal",
    overflowWrap: "anywhere",
    wordBreak: "break-all",
  } satisfies CSSProperties,

  graphWrap: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 14,
    minWidth: 0,
    width: "100%",
    boxSizing: "border-box",
    // Scale the SVG into the card — no horizontal scrollbar, no clip.
    overflow: "hidden",
  } satisfies CSSProperties,
  graphSvg: {
    display: "block",
    width: "100%",
    height: "auto",
    maxWidth: "100%",
  } satisfies CSSProperties,

  priorPrsWrap: {
    marginTop: 16,
    borderTop: "1px solid var(--border)",
    paddingTop: 14,
  } satisfies CSSProperties,
  priorPrsHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    cursor: "pointer",
    background: "none",
    border: "none",
    padding: 0,
    color: "var(--text-primary)",
    fontSize: 13,
    fontWeight: 600,
  } satisfies CSSProperties,
  priorPrsChevron: {
    color: "var(--text-muted)",
    transition: "transform .15s",
  } satisfies CSSProperties,
  priorPrsList: {
    listStyle: "none",
    margin: 0,
    marginTop: 10,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
  priorPrsRow: {
    display: "block",
    fontSize: 13,
    color: "var(--text-secondary)",
    textDecoration: "none",
  } satisfies CSSProperties,
  priorPrsNumber: {
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    color: "var(--text-primary)",
    fontWeight: 600,
  } satisfies CSSProperties,
  priorPrsMeta: {
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
