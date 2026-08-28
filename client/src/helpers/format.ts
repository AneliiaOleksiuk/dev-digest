/** Shared display formatters used across PR list / timeline / run-detail cost badges. */

const DEFAULT_CURRENCY = "USD";
const formatterCache = new Map<string, Intl.NumberFormat>();

/**
 * Cached per-currency symbol/code formatter. Fraction digits are left
 * unconstrained (0-20) because the amount passed in is ALREADY rounded by
 * `formatCost`'s own `toPrecision(2)` — this formatter must not re-round it,
 * only render the currency symbol/code correctly for the given currency.
 */
function currencyFormatter(currency: string): Intl.NumberFormat {
  let formatter = formatterCache.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 20,
    });
    formatterCache.set(currency, formatter);
  }
  return formatter;
}

/**
 * Cost with ~2 significant digits and no trailing zeros, so tiny per-run
 * costs (0.0013, 0.06) stay readable instead of rounding to "0.00" — this
 * rounding rule is unchanged. `null`/`undefined` (no data yet —
 * failed/running run) renders as "—". Defaults to USD; pass an ISO 4217
 * `currency` code for anything else.
 */
export function formatCost(amount: number | null | undefined, currency = DEFAULT_CURRENCY): string {
  if (amount == null) return "—";
  return currencyFormatter(currency).format(Number(amount.toPrecision(2)));
}

/**
 * Duration in ms → a compact human string ("420ms", "3.2s", "2m 5s"). `null`
 * (no data yet) renders as "—". De-duplicated (pr-self-review HIGH finding)
 * from byte-identical copies in AgentPerformanceView/helpers.ts and
 * AgentEditor/_components/StatsTab/helpers.ts — both re-export it from here
 * for their own call sites/tests.
 */
export function formatDurationMs(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m ${remainder}s`;
}

/**
 * Fractional rate (0..1) → a rounded percent string. `null` (no decided
 * findings yet — AC-12/E-10) renders as "—", never coerced to "0%". Same
 * de-duplication history as `formatDurationMs` above.
 */
export function formatPercent(rate: number | null): string {
  if (rate == null) return "—";
  return `${Math.round(rate * 100)}%`;
}
