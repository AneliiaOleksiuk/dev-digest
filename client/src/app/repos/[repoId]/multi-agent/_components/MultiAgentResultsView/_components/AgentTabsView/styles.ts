import type React from "react";

export const s = {
  root: { display: "flex", flexDirection: "column", gap: 14 } as React.CSSProperties,
  // Per-agent color needs a locally-built tab bar — the shared `Tabs`
  // primitive (`vendor/ui`, do-not-touch) hardcodes its underline/count to
  // the generic accent color, with no per-tab override.
  tabBar: { display: "flex", gap: 2, borderBottom: "1px solid var(--border)" } as React.CSSProperties,
  tabBtn: (active: boolean, color: string): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "12px 16px",
    border: "none",
    background: "transparent",
    borderBottom: "2px solid " + (active ? color : "transparent"),
    marginBottom: -1,
    cursor: "pointer",
    fontSize: 14,
    fontWeight: active ? 600 : 500,
    color: active ? "var(--text-primary)" : "var(--text-secondary)",
  }),
  tabScore: (color: string): React.CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 20,
    height: 20,
    padding: "0 5px",
    borderRadius: 10,
    fontSize: 11.5,
    fontWeight: 700,
    color: "#fff",
    background: color,
  }),
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
