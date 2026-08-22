import type React from "react";

export const s = {
  root: { display: "flex", flexDirection: "column", gap: 10, maxWidth: 1080, margin: "0 auto", width: "100%" } as React.CSSProperties,
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 } as React.CSSProperties,
  title: { fontSize: 15, fontWeight: 700 } as React.CSSProperties,
  toggleRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-secondary)" } as React.CSSProperties,
  row: { border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-surface)", padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8 } as React.CSSProperties,
  rowHead: { fontSize: 13, fontWeight: 600 } as React.CSSProperties,
  cells: { display: "flex", flexWrap: "wrap", gap: 8 } as React.CSSProperties,
  flaggedCell: (color: string): React.CSSProperties => ({
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: "6px 10px",
    borderRadius: 6,
    border: "1px solid " + color,
    minWidth: 120,
  }),
  ignoredCell: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: "6px 10px",
    borderRadius: 6,
    border: "1px dashed var(--border-strong)",
    background: "var(--bg-elevated)",
    minWidth: 120,
    color: "var(--text-muted)",
  } as React.CSSProperties,
  persona: { fontSize: 11.5, fontWeight: 600 } as React.CSSProperties,
  note: { fontSize: 11, lineHeight: 1.35 } as React.CSSProperties,
  empty: { fontSize: 13, color: "var(--text-muted)" } as React.CSSProperties,
};
