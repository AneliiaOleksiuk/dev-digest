import type React from "react";

export const s = {
  root: { display: "flex", flexDirection: "column", gap: 10, maxWidth: 1080, margin: "0 auto", width: "100%" } as React.CSSProperties,
  head: { display: "flex", flexDirection: "column", gap: 4 } as React.CSSProperties,
  title: { fontSize: 15, fontWeight: 700 } as React.CSSProperties,
  subtitle: { fontSize: 12.5, color: "var(--text-muted)" } as React.CSSProperties,
  note: { fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" } as React.CSSProperties,
  group: { border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-surface)", overflow: "hidden" } as React.CSSProperties,
  groupHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
    cursor: "pointer",
    fontSize: 13,
  } as React.CSSProperties,
  location: { fontSize: 12.5 } as React.CSSProperties,
  members: { fontSize: 12.5, color: "var(--text-muted)", flex: 1 } as React.CSSProperties,
  body: { padding: "0 14px 12px", display: "flex", flexDirection: "column", gap: 10 } as React.CSSProperties,
  empty: { fontSize: 13, color: "var(--text-muted)" } as React.CSSProperties,
};
