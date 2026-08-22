import type React from "react";

export const s = {
  card: (checked: boolean): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid " + (checked ? "var(--accent)" : "var(--border-strong)"),
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
