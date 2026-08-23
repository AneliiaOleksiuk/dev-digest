import type React from "react";

export const s = {
  root: { display: "flex", flexDirection: "column", gap: 20 } as React.CSSProperties,
  headerRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    maxWidth: 1080,
    margin: "0 auto",
  } as React.CSSProperties,
  headerRight: { display: "flex", alignItems: "center", gap: 16 } as React.CSSProperties,
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
  columnsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: 16,
  } as React.CSSProperties,
};
