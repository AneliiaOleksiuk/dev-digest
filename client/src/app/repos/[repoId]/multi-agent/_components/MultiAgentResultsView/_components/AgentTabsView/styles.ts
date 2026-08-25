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
  // Inactive tabs show a plain muted number, not the active tab's filled
  // color pill — matches the design screenshot, where only the active tab
  // carries color.
  tabScoreMuted: { fontSize: 12, fontWeight: 600, color: "var(--text-muted)" } as React.CSSProperties,
  // Per-agent summary card above the finding list — score, name, the
  // agent's own review summary, verdict, and duration/cost, all in one
  // glance before scrolling the findings themselves.
  summaryCard: (accentColor: string): React.CSSProperties => ({
    display: "flex",
    alignItems: "flex-start",
    gap: 14,
    padding: 16,
    borderRadius: 10,
    border: "1px solid " + accentColor,
    background: "var(--bg-surface)",
  }),
  summaryMain: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 } as React.CSSProperties,
  summaryTopRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 } as React.CSSProperties,
  summaryName: { fontSize: 15, fontWeight: 700, color: "var(--text-primary)" } as React.CSSProperties,
  summaryText: { fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5, margin: 0 } as React.CSSProperties,
  summaryMetaRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, fontSize: 12.5 } as React.CSSProperties,
  verdictLabel: (color: string): React.CSSProperties => ({ fontWeight: 700, color }),
  summaryStats: { color: "var(--text-muted)" } as React.CSSProperties,
  empty: { fontSize: 13, color: "var(--text-muted)", padding: "24px 0", textAlign: "center" } as React.CSSProperties,
};
