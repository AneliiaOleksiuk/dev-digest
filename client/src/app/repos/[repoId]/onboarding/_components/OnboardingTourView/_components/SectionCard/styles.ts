import type { CSSProperties } from "react";

/** Light outline that stays readable on dark fills (and inverts in light theme).
 *  Plain `--border` / `--border-strong` sit too close to `--bg-elevated` in dark
 *  mode and disappear on the First-tasks / Critical-paths / Run-locally cards. */
const lightOutline = "1px solid color-mix(in srgb, var(--text-primary) 18%, transparent)";

export const s = {
  card: {
    border: lightOutline,
    borderRadius: 8,
    background: "var(--bg-elevated)",
    overflow: "hidden",
  } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "12px 14px",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
  } satisfies CSSProperties,
  chevron: { flexShrink: 0, transition: "transform .12s" } satisfies CSSProperties,
  title: { fontSize: 14, fontWeight: 650, color: "var(--text-primary)", flex: 1 } satisfies CSSProperties,
  body: { padding: "0 14px 16px", fontSize: 13.5, color: "var(--text-secondary)" } satisfies CSSProperties,
  fallback: { fontSize: 13, color: "var(--text-muted)", fontStyle: "italic" } satisfies CSSProperties,
  links: { display: "flex", flexDirection: "column", gap: 6, marginTop: 10 } satisfies CSSProperties,
  link: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12.5,
    color: "var(--accent-text)",
    textDecoration: "none",
  } satisfies CSSProperties,
  // FIX-8 — `first_tasks` renders a card GRID, not the markdown `body`: one
  // small card per task (bold title, monospace path, complexity badge).
  taskGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: 10,
  } satisfies CSSProperties,
  taskCard: {
    border: lightOutline,
    borderRadius: 6,
    padding: "10px 12px",
    display: "flex",
    flexDirection: "column",
    gap: 6,
    background: "var(--bg-primary)",
  } satisfies CSSProperties,
  taskTitle: { fontSize: 13, fontWeight: 650, color: "var(--text-primary)" } satisfies CSSProperties,
  taskPath: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,

  // `critical_paths` — one bordered row per file, an "Open" action on the right.
  rowList: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  fileRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    border: lightOutline,
    borderRadius: 6,
    padding: "10px 12px",
    background: "var(--bg-primary)",
  } satisfies CSSProperties,
  fileRowIcon: { flexShrink: 0, color: "var(--text-muted)" } satisfies CSSProperties,
  fileRowText: { flex: 1, minWidth: 0, fontSize: 12.5, color: "var(--text-secondary)" } satisfies CSSProperties,
  fileRowPath: { color: "var(--text-primary)", fontWeight: 600 } satisfies CSSProperties,
  openButton: {
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 12,
    fontWeight: 500,
    padding: "4px 10px",
    borderRadius: 6,
    border: lightOutline,
    background: "var(--bg-elevated)",
    color: "var(--text-primary)",
    textDecoration: "none",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  // `reading_path` — a numbered circle per entry, path + reason stacked.
  readingRow: { display: "flex", alignItems: "flex-start", gap: 10 } satisfies CSSProperties,
  readingBadge: {
    flexShrink: 0,
    width: 20,
    height: 20,
    borderRadius: "50%",
    background: "var(--accent)",
    color: "#fff",
    fontSize: 11,
    fontWeight: 650,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  } satisfies CSSProperties,
  readingPath: { fontSize: 13, fontWeight: 650, color: "var(--text-primary)" } satisfies CSSProperties,
  readingDescription: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,

  // `run_locally` — one bordered row per command, a per-row copy action.
  commandRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    border: lightOutline,
    borderRadius: 6,
    padding: "8px 12px",
    background: "var(--code-bg)",
  } satisfies CSSProperties,
  commandIndex: { flexShrink: 0, width: 16, fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  commandText: {
    flex: 1,
    minWidth: 0,
    fontSize: 12.5,
    color: "var(--text-primary)",
    overflowX: "auto",
    whiteSpace: "pre",
  } satisfies CSSProperties,
} as const;
