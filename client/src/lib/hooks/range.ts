/* range.ts — shared `?range=` query-building for the two SPEC-06 hooks
   (`useAgentDetailStats`, `useAgentPerf`) that both hit a range-scoped
   endpoint on the server (`GET /agents/:id/stats`, `GET /agents/performance`).
   Kept as its own file (not duplicated in `hooks/agents.ts`) so a future
   range-scoped hook reuses the same query-string + query-key shape instead
   of re-deriving it. */

export type RangeMode = "1d" | "30d" | "custom";

export interface RangeQuery {
  range?: RangeMode;
  /** ISO date (yyyy-mm-dd); required when `range === "custom"`. */
  start?: string;
  end?: string;
}

/** Stable, serializable react-query key fragment for a range — so switching
 *  range actually refetches instead of reusing a stale cache entry. */
export function rangeQueryKey(range: RangeQuery): string {
  if (range.range === "custom") return `custom:${range.start ?? ""}:${range.end ?? ""}`;
  return range.range ?? "30d";
}

/** Build the `?range=&start=&end=` querystring suffix for a range-scoped
 *  GET (empty string when nothing needs to be sent, i.e. server default). */
export function rangeQueryString(range: RangeQuery): string {
  const params = new URLSearchParams();
  if (range.range) params.set("range", range.range);
  if (range.range === "custom") {
    if (range.start) params.set("start", range.start);
    if (range.end) params.set("end", range.end);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** Read `?range=&start=&end=` off the page's own URL (AC-6) — both the
 *  Stats tab and the Agent Performance dashboard call this against
 *  `useSearchParams()`. Falls back to the server's own default (30d) when
 *  absent/unrecognized, so a cold load with no `?range=` still resolves to a
 *  real, requestable range. */
export function rangeFromSearchParams(search: URLSearchParams): RangeQuery {
  const mode = search.get("range");
  if (mode === "1d" || mode === "30d") return { range: mode };
  if (mode === "custom") {
    return { range: "custom", start: search.get("start") ?? undefined, end: search.get("end") ?? undefined };
  }
  return { range: "30d" };
}

