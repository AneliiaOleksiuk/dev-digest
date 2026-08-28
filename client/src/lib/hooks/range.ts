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

/** fix-loop (A2) — true when the user picked "Custom" but hasn't entered
 *  both dates yet. Both `useAgentPerf`/`useAgentDetailStats` gate their
 *  request on the same condition (`enabled`) — callers use this to render
 *  validation copy instead of silently showing nothing while the query sits
 *  disabled, or the generic error state (which used to be what a 422 from
 *  submitting a half-entered range produced). */
export function isIncompleteCustomRange(range: RangeQuery): boolean {
  return range.range === "custom" && (!range.start || !range.end);
}

const MS_PER_DAY = 86_400_000;
/** Mirrors the server's `MAX_RANGE_DAYS`
 *  (`server/src/modules/agents/helpers.ts`) — hand-kept in sync, same as
 *  every other client/server contract pair in this repo (no shared
 *  validation module between the two packages for this). */
export const MAX_RANGE_DAYS = 366;

export type RangeValidationError = "startAfterEnd" | "tooLong" | null;

/**
 * fix-loop (Row 12/AC-4) — client-side pre-validation for a COMPLETE custom
 * range (both dates present), mirroring the server's `validateRangeQuery`
 * 422 conditions (`start > end`, span > 366 days,
 * `server/src/modules/agents/helpers.ts`). Both range-scoped hooks
 * (`useAgentPerf`, `useAgentDetailStats`) gate `enabled` on this returning
 * null, so an invalid complete range never round-trips to the server just to
 * get a 422 back — the caller renders specific copy instead of the generic
 * `loadError`. Returns null for an incomplete range too (that case is
 * `isIncompleteCustomRange`'s job, kept separate so callers can tell "still
 * typing" apart from "typed something invalid").
 */
export function validateCustomRange(range: RangeQuery): RangeValidationError {
  if (range.range !== "custom" || !range.start || !range.end) return null;
  const start = new Date(range.start);
  const end = new Date(range.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  if (start.getTime() > end.getTime()) return "startAfterEnd";
  const spanDays = Math.floor((end.getTime() - start.getTime()) / MS_PER_DAY) + 1;
  if (spanDays > MAX_RANGE_DAYS) return "tooLong";
  return null;
}

/** fix-loop (C bundled #2) — the write-side counterpart to
 *  `rangeFromSearchParams`: build the next `URLSearchParams` for a range
 *  change, preserving every other existing query param. Both
 *  `AgentPerformanceView` and `StatsTab` had duplicated this exact
 *  13-line `URLSearchParams` construction (differing only in which
 *  `router.replace` base path the caller then uses) — this is the one place
 *  it's built now. */
export function rangeToSearchParams(search: URLSearchParams, next: RangeQuery): URLSearchParams {
  const sp = new URLSearchParams(search.toString());
  sp.set("range", next.range ?? "30d");
  if (next.range === "custom") {
    if (next.start) sp.set("start", next.start);
    else sp.delete("start");
    if (next.end) sp.set("end", next.end);
    else sp.delete("end");
  } else {
    sp.delete("start");
    sp.delete("end");
  }
  return sp;
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

