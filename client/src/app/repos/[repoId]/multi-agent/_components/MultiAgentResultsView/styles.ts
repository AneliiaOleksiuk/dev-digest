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
  metaLine: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-muted)" } as React.CSSProperties,
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
