/**
 * Eval module engineering caps, following `modules/project-context/constants.ts`'s
 * pattern (caps live here; deployment-changeable config lives in `platform/config.ts`
 * — this module has none of the latter yet).
 */

/** `input_diff` size cap on write (AC-46) — comfortably under the app's
 *  hardcoded 1 MB `bodyLimit` (`server/AGENTS.md`) so an oversized diff fails
 *  with this module's own named error, not a generic 413 from Fastify. */
export const MAX_INPUT_DIFF_BYTES = 256_000;

/** Max cases run in one batch (Q-4) — bounds the worst-case spend of a
 *  "run the whole set" batch (WI7, Phase C). Referenced here (not just in
 *  Phase C) since it's a case-set-shape constant, not a runner-only one. */
export const MAX_CASES_PER_BATCH = 25;

/** Per-case timeout (Q-4, WI7/Phase C) via the existing `withTimeout`
 *  (`platform/resilience.ts`) — a timed-out case is a failed case (AC-20),
 *  not a failed batch. */
export const EVAL_CASE_TIMEOUT_MS = 120_000;

/** Rate limit for `POST /agents/:id/eval-runs` / `POST /eval-cases/:id/run`
 *  (AC-45, WI7/Phase C) — same shape `modules/reviews/routes.ts` already uses
 *  for its rate-limited routes. Declared here (not deferred to Phase C) so
 *  the whole module's caps live in one file. */
export const EVAL_RUN_RATE_LIMIT = { max: 10, timeWindow: '1 minute' };

/**
 * Finding kinds `reviewer-core`'s grounding gate treats as full-file (no
 * diff-hunk line-range check) — `reviewer-core/src/grounding.ts:16`'s
 * `FULL_FILE_KINDS`. Duplicated here (not imported) because that constant is
 * module-private in `reviewer-core` and re-exporting it would mean touching a
 * package this feature must not touch (Q-6). Drives an expectation entry's
 * `match_scope`: one of these four kinds → `'file'`, everything else →
 * `'range'` (the contract default). See `helpers.ts`'s `deriveMatchScope`
 * and `scorer.ts`'s `matchesExpectation`.
 */
export const FULL_FILE_KINDS = new Set(['secret_leak', 'lethal_trifecta', 'phantom', 'hook']);
