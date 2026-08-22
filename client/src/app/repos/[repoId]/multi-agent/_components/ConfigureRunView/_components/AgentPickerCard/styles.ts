import type React from "react";

export const s = {
  card: (checked: boolean, accentColor: string): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 14px",
    borderRadius: 8,
    borderTop: "1px solid " + (checked ? accentColor : "var(--border-strong)"),
    borderRight: "1px solid " + (checked ? accentColor : "var(--border-strong)"),
    borderBottom: "1px solid " + (checked ? accentColor : "var(--border-strong)"),
    borderLeft: "3px solid " + accentColor,
    background: "var(--bg-elevated)",
    marginBottom: 8,
  }),
  main: { flex: 1, minWidth: 0 } as React.CSSProperties,
  nameRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600 } as React.CSSProperties,
  metaRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--text-muted)", marginTop: 2 } as React.CSSProperties,
  estimate: { fontSize: 12.5, color: "var(--text-secondary)", textAlign: "right", flexShrink: 0 } as React.CSSProperties,
  estimateMuted: { fontSize: 12.5, color: "var(--text-muted)", fontStyle: "italic", textAlign: "right", flexShrink: 0 } as React.CSSProperties,
  sampleNote: { fontSize: 11.5, color: "var(--text-muted)" } as React.CSSProperties,
};
