import type React from "react";

export const s = {
  root: { display: "flex", flexDirection: "column", gap: 20 } as React.CSSProperties,
  // Full-bleed, edge-to-edge (unlike ConfigureRunView's centered 720px form)
  // — matches the design screenshot, where "Configure run" sits at the true
  // left edge and the Columns/Tabs toggle at the true right edge, not
  // confined to a centered column.
  headerRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  } as React.CSSProperties,
  headerLeft: { display: "flex", alignItems: "center", gap: 14 } as React.CSSProperties,
  titleLine: { fontSize: 15, fontWeight: 700, color: "var(--text-primary)" } as React.CSSProperties,
  titleMeta: { fontSize: 13, fontWeight: 500, color: "var(--text-muted)", marginLeft: 8 } as React.CSSProperties,
  prRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  } as React.CSSProperties,
  prTitle: { fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" } as React.CSSProperties,
  metaLine: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-muted)" } as React.CSSProperties,
  // Compact segmented control for Columns/Tabs — two layouts over the same
  // batch, not a navigational tab set, so it gets its own small pill rather
  // than the full-width underlined `Tabs` primitive (reserved for the
  // per-agent tabs inside the Tabs layout itself).
  viewToggle: {
    display: "flex",
    alignItems: "center",
    gap: 2,
    padding: 2,
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } as React.CSSProperties,
  viewToggleBtn: (active: boolean): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 10px",
    borderRadius: 5,
    border: "none",
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
    color: active ? "var(--text-primary)" : "var(--text-muted)",
    background: active ? "var(--bg-hover)" : "transparent",
  }),
  // Visually hidden but still announced — the `sr-only` clip-rect pattern
  // (kept local since `vendor/ui` has no shared primitive for it).
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clip: "rect(0,0,0,0)",
    whiteSpace: "nowrap",
    border: 0,
  } as React.CSSProperties,
  // Fixed 4-per-row, per the design screenshot — not `auto-fit`, which
  // reflows to however many 320px+ cards fit the viewport. `minmax(0, 1fr)`
  // (not a bare `1fr`) so a card's unbreakable content (a long `file:line`
  // finding path) can't steal width from its siblings and collapse them.
  columnsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: 16,
  } as React.CSSProperties,
};
