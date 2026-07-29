/** Shared display formatters used across PR list / timeline / run-detail cost badges. */

/**
 * USD cost with ~2 significant digits and no trailing zeros, so tiny per-run
 * costs ($0.0013, $0.06) stay readable instead of rounding to "$0.00".
 * `null`/`undefined` (no data yet — failed/running run) renders as "—".
 */
export function formatCost(usd: number | null | undefined): string {
  if (usd == null) return "—";
  if (usd === 0) return "$0";
  return `$${Number(usd.toPrecision(2))}`;
}
