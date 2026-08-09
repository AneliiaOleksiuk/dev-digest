import type { IconName } from "@devdigest/ui";

/**
 * Simple keyword heuristics mapping a short risk-area bullet to a
 * severity-tinged icon (mock: auth/dependency/perf-flavoured icons). Falls
 * back to a neutral warning icon when nothing matches — never guesses wrong
 * on purpose, per docs/plans/intent-layer.md WI11.
 */
export function riskIconFor(text: string): IconName {
  const lower = text.toLowerCase();
  if (/\bauth(entication|orization)?\b/.test(lower)) return "Shield";
  if (/\b(depend|package|npm|library|libraries)\b/.test(lower)) return "Boxes";
  if (/\b(perf|latency|redis|cache|throughput|round trip|round-trip)\b/.test(lower)) return "Zap";
  return "AlertTriangle";
}

/** Icon/text color for a risk pill — mock uses tinted icons (auth red,
 *  dependency amber, perf muted), not a uniform warn orange. */
export function riskColorFor(text: string): string {
  const lower = text.toLowerCase();
  if (/\bauth(entication|orization)?\b/.test(lower)) return "var(--crit)";
  if (/\b(depend|package|npm|library|libraries)\b/.test(lower)) return "var(--warn)";
  if (/\b(perf|latency|redis|cache|throughput|round trip|round-trip)\b/.test(lower)) {
    return "var(--text-muted)";
  }
  return "var(--warn)";
}

/** Truncate to `max` chars on a word boundary, appending an ellipsis — used
 *  to keep `missing_context` from outranking objective/scope/risks (WI11). */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
