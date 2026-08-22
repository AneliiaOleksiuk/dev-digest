import type React from "react";

export const s = {
  root: { display: "flex", flexDirection: "column", gap: 14 } as React.CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "10px 0",
  } as React.CSSProperties,
  agentMeta: { display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--text-muted)" } as React.CSSProperties,
  empty: { fontSize: 13, color: "var(--text-muted)", padding: "24px 0", textAlign: "center" } as React.CSSProperties,
};
