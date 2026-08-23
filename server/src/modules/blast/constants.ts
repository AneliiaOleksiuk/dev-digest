/**
 * Blast module display caps. `repo-intel`'s `MAX_CALLERS_PER_SYMBOL` already
 * caps callers per symbol at the facade layer (WI1); these two caps bound
 * how much of the mapped response this module renders on top of that.
 */

/** Max changed-symbol groups (`downstream[]` entries) returned to a caller. */
export const MAX_CHANGED_SYMBOLS_RENDERED = 30;

/** Max distinct endpoints listed in a single `downstream[].endpoints_affected`. */
export const MAX_ENDPOINTS_LISTED = 20;

/**
 * Endpoint / cron attribution depth for Blast Radius (L04 acceptance fix):
 * direct callers of a changed symbol, PLUS modules within ≤2 reverse-import
 * hops of the changed declaring file (`file_edges`, imported → importers).
 * Callers-of-callers are still not walked via the reference graph.
 */
export const DEPTH_NOTE =
  'endpoints/crons come from files that directly call a changed symbol and from modules within 2 reverse-import hops of the changed file';

/**
 * "Prior PRs touching these files" (WI3, L04 follow-ups). Display/read-time
 * caps only — not behaviour switches, mirroring `repo-intel/constants.ts`'s
 * `MAX_CALLERS_PER_SYMBOL` convention.
 */

/** Max prior PRs returned in `prior_prs`. */
export const MAX_PRIOR_PRS = 5;

/** Max of the current PR's own changed file paths sent into the `IN (…)`
 *  overlap query, so a 900-file PR can't build a pathological query. */
export const MAX_PATHS_FOR_PRIOR_PRS = 200;
