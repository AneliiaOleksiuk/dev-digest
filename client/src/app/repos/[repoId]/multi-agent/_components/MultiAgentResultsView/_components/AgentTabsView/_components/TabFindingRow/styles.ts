import type React from "react";

export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 0, marginBottom: 12 } as React.CSSProperties,
  extraActions: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 14px",
    borderTop: "1px dashed var(--border)",
    background: "var(--bg-elevated)",
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
  } as React.CSSProperties,
  confirmText: { fontSize: 12, color: "var(--ok)" } as React.CSSProperties,
};
