/**
 * Brief module engineering caps (SPEC-03), per `project-context/constants.ts`'s
 * pattern — caps live in the module's own constants file, not scattered
 * across service.ts/budget.ts.
 */

/** Hard input-token budget for the assembled call (AC-23), measured with
 *  `container.tokenizer` on the FULLY assembled system+user input, before
 *  the call is issued. */
export const BRIEF_INPUT_TOKEN_BUDGET = 8_000;

/** Sub-cap on the spec-file input alone (AC-27) — strictly below the total
 *  budget so one linked design doc can't consume the whole thing (E-12).
 *  31% of the 8 000 total; Q-5's proposed value (no clean in-repo anchor —
 *  `intent-service.ts`'s 20 000-char/file cap and `PROJECT_CONTEXT_TOKEN_BUDGET`
 *  (8 000) are both too large to sit *inside* this budget). */
export const SPEC_INPUT_TOKEN_SUBCAP = 2_500;

/** Max spec files admitted, mirroring the intent path's own cap
 *  (`MAX_SPEC_FILES` in `intent-service.ts`) but scoped separately here so a
 *  change to one doesn't silently change the other. */
export const MAX_SPEC_FILES = 2;

/** Pure I/O bound on a single spec-file read — NOT a content cap. Admission
 *  is decided entirely by `SPEC_INPUT_TOKEN_SUBCAP`, measured in tokens,
 *  whole-document only (see `budget.ts`). This just stops a pathological
 *  multi-megabyte `.md` from being slurped into memory before it's measured;
 *  it never binds the content decision. There is deliberately no
 *  `MAX_SPEC_FILE_CHARS` content cap (an earlier draft had one; removed
 *  after cross-model review because it silently truncated documents the
 *  token sub-cap would have admitted intact). ≈4× the sub-cap's char
 *  equivalent. */
export const MAX_SPEC_FILE_READ_CHARS = 40_000;

/** Why Timeline row cap. */
export const MAX_TIMELINE_ENTRIES = 50;

/** Render/persist caps applied to the model's grounded output, regardless of
 *  what the prompt asked for (the model may not respect the ask). */
export const MAX_RISKS = 6;
export const MAX_FOCUS_ITEMS = 5;

/** Same rate as the other model-spending PR routes (`reviews/routes.ts`,
 *  AC-38). */
export const BRIEF_RATE_LIMIT = { max: 10, timeWindow: '1 minute' };
