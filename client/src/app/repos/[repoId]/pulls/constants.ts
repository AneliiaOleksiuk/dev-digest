import type { PrMeta } from "../../../../lib/types";

/** Constants for the PR list page (/repos/:repoId/pulls). */

/**
 * Review status → colour token + i18n label key (under `list.status`). Open PRs
 * carry a derived review status (needs_review / reviewed / stale); merged/closed
 * keep their GitHub merge state.
 */
export const STATUS_META: Record<string, { c: string; labelKey: string }> = {
  needs_review: { c: "var(--warn)", labelKey: "needs_review" },
  reviewed: { c: "var(--ok)", labelKey: "reviewed" },
  stale: { c: "var(--stale)", labelKey: "stale" },
  open: { c: "var(--warn)", labelKey: "open" },
  merged: { c: "var(--ok)", labelKey: "merged" },
  closed: { c: "var(--stale)", labelKey: "closed" },
};

/** Size bucket → colour token. */
export const SIZE_COLOR: Record<string, string> = {
  S: "var(--ok)",
  M: "var(--warn)",
  L: "var(--crit)",
};

/** Grid template for both the header row and PR rows. Findings is 140px (not
 *  100px) so 3 compact severity badges with 2-digit counts fit on one line
 *  without wrapping (`findingsCell` in styles.ts pairs this with
 *  `flexWrap: "nowrap"`). The title column has a 200px floor (`minmax`, not
 *  bare `1fr`) so it stops crushing the PR title as the window narrows;
 *  once the row hits `MIN_ROW_WIDTH` the table scrolls horizontally
 *  (`tableCard` in styles.ts) instead of clipping the fixed-width columns. */
export const GRID = "minmax(200px, 1fr) 132px 92px 60px 140px 118px 72px 78px";

/** Sum of the fixed-width columns + title floor + inter-column gaps (14px × 7)
 *  in `GRID`. Applied as `minWidth` on the header/row grids so the browser
 *  triggers `tableCard`'s horizontal scroll instead of squeezing columns. */
export const MIN_ROW_WIDTH = 200 + 132 + 92 + 60 + 140 + 118 + 72 + 78 + 14 * 7;

/** Line-count thresholds for the S/M/L size bucket. */
export const SIZE_SMALL_MAX = 100;
export const SIZE_MEDIUM_MAX = 400;

/** Filter chips: status key + i18n label key (under `list.filter`). */
export const STATUS_FILTERS: { key: string; labelKey: string }[] = [
  { key: "all", labelKey: "all" },
  { key: "needs_review", labelKey: "needs_review" },
  { key: "reviewed", labelKey: "reviewed" },
  { key: "stale", labelKey: "stale" },
];

/** Column header i18n keys (under `list.columns`), in display order. */
export const COLUMN_KEYS: string[] = [
  "pullRequest",
  "author",
  "size",
  "score",
  "findings",
  "status",
  "cost",
  "updated",
];

/** Number of skeleton rows shown while loading. */
export const SKELETON_ROWS = 4;

export type PrSize = "S" | "M" | "L";
export type SizeInfo = { size: PrSize; lines: number };

/** Re-exported for helpers that consume PrMeta. */
export type { PrMeta };
