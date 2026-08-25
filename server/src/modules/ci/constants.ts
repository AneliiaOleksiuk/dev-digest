/**
 * CI module generator invariants. Every value the generator (`workflow.ts`,
 * `manifest.ts`) emits and every value the re-validator (`workflow-validate.ts`)
 * checks against comes from HERE, as a single named export — Recommendation 2
 * of `docs/plans/spec-04-export-to-ci.md`: with no test written in this pass,
 * one shared source of truth is the only thing keeping the generator and the
 * validator from silently drifting apart. Follows
 * `modules/project-context/constants.ts`'s pattern (engineering caps live
 * here; deployment-changeable config lives in `platform/config.ts` — this
 * module has none of the latter).
 */

// ---- exported file paths (AC-9) --------------------------------------------

export const DEVDIGEST_DIR = '.devdigest';
export const AGENTS_SUBDIR = `${DEVDIGEST_DIR}/agents`;
export const SKILLS_SUBDIR = `${DEVDIGEST_DIR}/skills`;
export const RUNNER_PATH = `${DEVDIGEST_DIR}/runner/index.js`;
export const MEMORY_PATH = `${DEVDIGEST_DIR}/memory.jsonl`;
export const WORKFLOW_PATH = '.github/workflows/devdigest-review.yml';
export const INGEST_SECRET_NAME_LEGACY = 'DEVDIGEST_INGEST_TOKEN';

// ---- namespaced-path derivations (SPEC-05) ----------------------------------
//
// Every namespaced path this module ever emits or checks is produced by ONE
// of the functions below, never a `.devdigest/`/`.github/workflows/` literal
// written out anywhere else (Recommendation 2's "single source of truth",
// extended). `namespace: string | null` — `null` means "legacy" (AC-14) and
// every function below returns the EXISTING SPEC-04 literal unchanged in
// that case; a non-null namespace (already `slugify`'s hardened output —
// `helpers.ts`'s `deriveNamespace`) resolves the SPEC-05 layout. One-way
// import direction: this file may not import `helpers.ts` (namespace
// DERIVATION — name to slug — lives there; path SHAPE lives here), and
// `helpers.ts` may not import these (enforced by review, not tooling).
//
// `RUNNER_PATH` and `RUN_COMMAND` are DELIBERATELY NOT parameterised here
// (AC-6, AC-20) — the runner bundle stays one shared file per repository
// regardless of how many namespaced installations read it.

export function agentsSubdirFor(namespace: string | null): string {
  return namespace ? `${DEVDIGEST_DIR}/${namespace}/agents` : AGENTS_SUBDIR;
}

export function skillsSubdirFor(namespace: string | null): string {
  return namespace ? `${DEVDIGEST_DIR}/${namespace}/skills` : SKILLS_SUBDIR;
}

export function memoryPathFor(namespace: string | null): string {
  return namespace ? `${DEVDIGEST_DIR}/${namespace}/memory.jsonl` : MEMORY_PATH;
}

export function workflowPathFor(namespace: string | null): string {
  return namespace ? `.github/workflows/devdigest-review-${namespace}.yml` : WORKFLOW_PATH;
}

/** The runner's `DEVDIGEST_DIR` env value (AC-19) — `null` for legacy, which
 *  means "emit no `DEVDIGEST_DIR` key at all", leaving the runner's own
 *  `<cwd>/.devdigest` default in force (`agent-runner/src/index.ts:31`). */
export function devdigestDirFor(namespace: string | null): string | null {
  return namespace ? `${DEVDIGEST_DIR}/${namespace}` : null;
}

/** `DEVDIGEST_INGEST_TOKEN_<NAMESPACE>` (AC-25, AC-22) — uppercased,
 *  `-` → `_`. Because `slugify` emits only `[a-z0-9-]`, no `_` can survive
 *  into a namespace, so this mapping cannot collide two distinct namespaces
 *  onto one secret name. The `DEVDIGEST_INGEST_TOKEN_` prefix guarantees
 *  GitHub's Actions-secret naming rules (alphanumerics/underscores only, not
 *  digit-leading, not `GITHUB_`-prefixed) regardless of the namespace. */
export function ingestSecretNameFor(namespace: string | null): string {
  return namespace
    ? `DEVDIGEST_INGEST_TOKEN_${namespace.toUpperCase().replace(/-/g, '_')}`
    : INGEST_SECRET_NAME_LEGACY;
}

/** The namespaced workflow's top-level `name:` (AC-21) — `null` for legacy,
 *  which means "emit no `name:` key at all" (AC-16 — a changed workflow name
 *  changes the check name and can silently invalidate a required status
 *  check already configured in the target repo's branch protection). Drawn
 *  from the SAME filename-safe charset as the namespace itself (the slug
 *  charset), never the agent's raw display name. */
export function workflowNameFor(namespace: string | null): string | null {
  return namespace ? `devdigest-review-${namespace}` : null;
}

// ---- the review invocation (AC-25, D-2, D-14) -------------------------------

/** The runner reads its entire configuration from `process.env` and
 *  auto-discovers the manifest itself — no subcommand, no CLI flags, and
 *  never `index.mjs` (`agent-runner/src/index.ts`, `agent-runner/README.md`). */
export const RUN_COMMAND = 'node .devdigest/runner/index.js';

// ---- workflow trigger allow/deny lists (AC-19, AC-20) -----------------------

/** Never emitted, under any trigger selection, for any `post_as` (AC-20, E-4). */
export const FORBIDDEN_EVENTS = [
  'pull_request_target',
  'issue_comment',
  'pull_request_review_comment',
  'workflow_run',
  'workflow_dispatch',
] as const;

/** The only `pull_request` activity types the generated workflow may declare
 *  (AC-19) — the generator intersects the caller's requested triggers against
 *  this list rather than trusting the request, so an unexpected trigger value
 *  can never reach the emitted YAML. */
export const ALLOWED_TRIGGERS = ['opened', 'synchronize', 'reopened'] as const;
export type AllowedTrigger = (typeof ALLOWED_TRIGGERS)[number];

// ---- permissions (AC-21, AC-22, D-7) ----------------------------------------

/** Workflow-level `permissions:` when the run posts a review/comment. No
 *  job-level `permissions:` is ever emitted alongside this — nothing may
 *  widen it. */
export const PERMISSIONS_POST = { contents: 'read', 'pull-requests': 'write' } as const;

/** Workflow-level `permissions:` when `post_as === 'none'` — nothing is
 *  posted, so `pull-requests` stays read-only (AC-22). */
export const PERMISSIONS_NO_POST = { contents: 'read', 'pull-requests': 'read' } as const;

// ---- fork guard (AC-23, D-6, E-3) -------------------------------------------

/** The exact job-level `if:` expression the generator emits and the
 *  validator requires byte-for-byte on a hand-edited override — one string,
 *  shared, so the two can never independently drift on what "the fork guard"
 *  means (Recommendation 2). References `github.event.*`, which AC-30 only
 *  forbids inside `run:` bodies, not inside `if:` conditions. */
export const FORK_GUARD_EXPR =
  'github.event.pull_request.head.repo.full_name == github.repository';

// ---- pinned actions (AC-24, Q-5) --------------------------------------------

/**
 * The only two actions the generated workflow ever references. Both resolved
 * via `git ls-remote --tags <repo>` on 2026-08-23 — a SHA is NEVER guessed; if
 * a future refresh cannot reach the network, stop and report rather than
 * inventing one (a wrong SHA is a workflow that fails at its first step in a
 * stranger's repository).
 */
export const PINNED_ACTIONS = {
  checkout: {
    name: 'actions/checkout',
    sha: '11bd71901bbe5b1630ceea73d27597364c9af683',
    version: 'v4.2.2',
  },
  setupNode: {
    name: 'actions/setup-node',
    sha: '49933ea5288caeca8642d1e84afbd3f7d6820020',
    version: 'v4.4.0',
  },
} as const;

// ---- misc generator invariants ----------------------------------------------

/** The runner's GitHub client is built on native `fetch` and documents Node
 *  22 (`agent-runner/src/github.ts:6-12`); root `AGENTS.md` pins Node ≥ 22.
 *  The design mockup's `node-version: 20` is below this floor and must never
 *  be emitted (AC-29, E-29). */
export const NODE_VERSION = '22';

/** The LEGACY (unnamespaced) branch Install commits to and opens a PR from
 *  (AC-34) — kept unchanged for a `namespace === null` installation (AC-14's
 *  freeze). Namespaced installations use `ciBranchFor` below instead: one
 *  branch, and therefore one PR, PER INSTALLATION — never shared across
 *  agents, so a second agent's export can never land inside a PR titled
 *  after a different agent, and never re-derive/overwrite a path another
 *  installation owns via `findOpenPr`'s branch-scoped lookup. */
export const CI_BRANCH = 'devdigest/ci';

/** The branch a given installation's Install commits to and opens its OWN PR
 *  from — `null` (legacy) returns `CI_BRANCH` unchanged; a namespaced
 *  installation gets `${CI_BRANCH}-${namespace}`, so N agents on one
 *  repository produce N independent branches/PRs, each named after and
 *  containing ONLY that installation's own files (mirrors `workflowPathFor`'s
 *  per-namespace shape). */
export function ciBranchFor(namespace: string | null): string {
  return namespace ? `${CI_BRANCH}-${namespace}` : CI_BRANCH;
}

/** Bumped BY HAND whenever `workflow.ts` changes what it emits (AC-18) — lets
 *  an installation row record which generator version produced its workflow.
 *  Bumped to 2 for SPEC-05: a namespaced installation's workflow now emits
 *  `name:` and a namespace-scoped `DEVDIGEST_DIR`/ingest-secret reference; a
 *  legacy installation's re-export emits byte-identical YAML but records `2`
 *  too — harmless, since the CI tab's drift banner compares `agent_version`,
 *  not `workflow_version` (`CiTab/helpers.ts`'s `isDrifted`). */
export const WORKFLOW_VERSION = 2;

/** >= 256 bits (AC-50). */
export const INGEST_TOKEN_BYTES = 32;

/** `POST /agents/:id/export-ci` (AC-77) — matches
 *  `modules/reviews/routes.ts:43,65`'s existing paid-call-adjacent shape. */
export const EXPORT_RATE_LIMIT = { max: 10, timeWindow: '1 minute' } as const;

/** `POST /ci/ingest` (AC-59, Q-7) — one installation posts a handful of times
 *  per PR event; this bounds a busy repo's fan-in without throttling it. */
export const INGEST_RATE_LIMIT = { max: 60, timeWindow: '1 minute' } as const;

/** Safely below `app.ts`'s hardcoded 1 MB `bodyLimit` (AC-59, `server/AGENTS.md`)
 *  — the ingest artifact is a small JSON summary, never a diff or a prompt. */
export const MAX_INGEST_BODY_BYTES = 256 * 1024;
