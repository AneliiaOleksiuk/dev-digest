/**
 * Onboarding module engineering caps (AC-13/AC-14), each anchored to an
 * existing in-repo precedent per D-9 — proposals, not settled certainty.
 */

// --- Fact-collection bounds (AC-13) -----------------------------------------

/** Ranked files sampled for excerpts — = conventions' `SAMPLE_SIZE`
 *  (`modules/conventions/constants.ts:1`). */
export const MAX_RANKED_FILES_SAMPLED = 12;

/** Per-file excerpt cap in chars — = conventions' `MAX_FILE_CHARS`
 *  (`modules/conventions/constants.ts:2`). */
export const MAX_EXCERPT_CHARS = 4000;

/** Repo-map token budget — re-used from `repo-intel/constants.ts`'s
 *  `DEFAULT_REPO_MAP_TOKEN_BUDGET`. */
export const REPO_MAP_TOKEN_BUDGET = 1500;

/** Total facts token budget — = `project-context/constants.ts`'s
 *  `PROJECT_CONTEXT_TOKEN_BUDGET`. Enforced by dropping whole ranked-file
 *  excerpts in ascending-rank order (never mid-file truncation). */
export const FACTS_TOKEN_BUDGET = 8000;

/** Max `package.json` files walked for "How to run locally" (E-7,
 *  Recommendation 3) — deterministic: root + every `package.json` at depth
 *  ≤ `RUN_LOCALLY_WALK_DEPTH`, sorted by path, capped here. This repo is
 *  itself the anchor case: five packages, no workspace. */
export const MAX_RUN_LOCALLY_SOURCES = 5;

/** Max directory depth walked when discovering `package.json` files
 *  (0 = repo root). */
export const RUN_LOCALLY_WALK_DEPTH = 2;

// --- Render bounds (AC-14) — applied to the model's output regardless of
// what was sent, since the model may not respect the input bounds. ---------

/** Max reading-path entries rendered. */
export const MAX_READING_PATH_ENTRIES = 12;

/** Max critical-path rows rendered. */
export const MAX_CRITICAL_PATH_ROWS = 10;

/** Max run-locally steps rendered. */
export const MAX_RUN_LOCALLY_STEPS = 10;

/** Max first-task cards rendered. */
export const MAX_FIRST_TASK_CARDS = 6;

/** Max links per section — already stated by `prompts/onboarding.system.md`. */
export const MAX_LINKS_PER_SECTION = 4;
