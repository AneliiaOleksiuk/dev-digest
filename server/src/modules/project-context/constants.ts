/**
 * Project Context (SPEC-01) constants. Engineering caps (bytes/count/chars/
 * budget) live here, following `modules/repo-intel/constants.ts`'s pattern —
 * the search-root *configuration* itself lives in `platform/config.ts`
 * (`AppConfig.projectContextRoots`, env `PROJECT_CONTEXT_ROOTS`) since it's a
 * deployment-changeable value, not an engineering cap (D-3/Q10).
 */

/** Only `.md` documents are discovered. */
export const DOC_EXT = '.md';

/** Default search roots (mirrors `AppConfig.projectContextRoots`'s default —
 *  documented here too so a reader of this module sees the default without
 *  cross-referencing `platform/config.ts`). */
export const DEFAULT_CONTEXT_ROOTS = ['specs', 'docs', 'insights'];

/** Per-document read cap (below repo-intel's 400 KB `MAX_FILE_SIZE` — a
 *  doc's whole text is billed to the LLM, not parsed and discarded). */
export const MAX_DOC_FILE_BYTES = 256 * 1024;

/** Total discovered `.md` files per repo (below repo-intel's 5000
 *  `MAX_INDEXED_FILES` — three roots of `.md` is a much smaller set than a
 *  whole-repo walk). */
export const MAX_DISCOVERED_DOCS = 2000;

/** Per-document char cap at injection time — exactly `MAX_SPEC_FILE_CHARS`
 *  (`modules/reviews/intent-service.ts`), so the two spec-reading paths
 *  truncate identically. */
export const MAX_DOC_CHARS = 20_000;

/** Total token budget for the injected project-context set (AC-22). Larger
 *  than repo-map's 1500-token `DEFAULT_REPO_MAP_TOKEN_BUDGET` — this slot is
 *  user-chosen and is the feature's whole point — while still bounding a
 *  several-document attachment. */
export const PROJECT_CONTEXT_TOKEN_BUDGET = 8000;

/** Max `/`-separated segments in a write-path request (AC-47, D-12). Value
 *  approved by the product owner — anchored the same way `MAX_DOC_FILE_BYTES`
 *  is anchored against `repo-intel/pipeline/walk.ts:1-70`: generous enough
 *  for a realistic nested doc (e.g. `docs/adr/0004/rfc/draft.md` is 5 deep)
 *  while still bounding one request's `mkdir` chain (AC-46). */
export const MAX_DOC_PATH_DEPTH = 8;

/** Max character length of a write-path request (AC-47, D-12). 200 is safely
 *  under win32's 260-char `MAX_PATH` once a clone-dir prefix
 *  (`<cloneDir>/<owner>/<repo>/`) is added — the same win32 reasoning D-12
 *  anchors the accepted-path-shape rules against. */
export const MAX_DOC_PATH_LENGTH = 200;

/** Max number of dirty-clone paths shown in a blocked-resync refusal
 *  (AC-52) — "bounded to a readable count", not the full `git status`
 *  output. */
export const MAX_DIRTY_PATHS_SHOWN = 10;
