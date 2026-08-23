# Export to CI API & contracts

Stable lookup for the shipped Export-to-CI HTTP surface and Zod shapes. For
behaviour and design — including the ingest-auth design as **actually
shipped** (Bearer token + hash-keyed lookup, not the originally-specified
installation-id header) — see
[`docs/features/export-to-ci.md`](../features/export-to-ci.md).

## HTTP

Routes live in `server/src/modules/ci/routes.ts`. Every route **except**
`POST /ci/ingest` resolves tenancy via `getContext(app.container, req)`
before any work; the ingest route resolves tenancy from the authenticated
installation instead (see its row below).

### Preview, Install, zip (Phase B/C)

| Method | Path | Behaviour |
|---|---|---|
| `POST` | `/agents/:id/export-ci/preview` | Generates the file set with **zero side effects** — no GitHub call, no token minted, no `ci_installations` row. Body: `CiExportInput`. `target` must be `'gha'` (rejected otherwise); `repo` must parse as a strict `owner/name` ref. The runner-bundle entry is a size placeholder (`preview_omitted: true`), never the real bytes. |
| `POST` | `/agents/:id/export-ci` | Install **and** "Update CI config" (same route, same body shape — an existing `(agent, repo)` installation is updated in place and keeps its existing token). Regenerates the whole file set server-side (the only client-supplied content is `workflow_override`); re-validates a submitted override server-side before committing; mints a token only when creating a new installation; commits to `devdigest/ci` and opens/reuses a PR; persists the installation last. Rate-limited `{ max: 10, timeWindow: '1 minute' }` (`EXPORT_RATE_LIMIT`). Returns `CiExport`, with `ingest_token` non-null only on a genuine create. |
| `POST` | `/agents/:id/export-ci/zip` | Identical generation + override re-validation, returns `application/zip` (JSZip) of the file set including the real bundle bytes. **Zero GitHub writes, no installation created, no token minted** — an "install it yourself" escape hatch; CI Runs won't record anything from a repo installed this way until it's later installed through the PR path. Same rate limit as Install. |

### Ingest — the one result-accepting route (Phase C, WI14)

| Method | Path | Behaviour |
|---|---|---|
| `POST` | `/ci/ingest` | The module's **only** result-accepting route. Authenticated by a single `Authorization: Bearer <token>` header — the exact shape the generated workflow's reporting step sends — **not** by `getContext`/session. Order, all of which must pass before any write: (1) rate limit `{ max: 60, timeWindow: '1 minute' }` (`INGEST_RATE_LIMIT`) + a 256 KB body cap (`MAX_INGEST_BODY_BYTES`, well under the server's global 1 MB `bodyLimit`); (2) hash the presented token with SHA-256 and look up the installation whose stored `token_hash` matches — the match itself is the authentication; no matching hash / absent / malformed header → `401`, writes nothing; (3) zod-validate the body against `CiIngestInput` **only after** the auth check (deliberately not declared as a Fastify route schema, so an unauthenticated caller can't probe body validity) — failure → `422`, no partial row; (4) reject if the body's `repo` doesn't string-equal the installation's own `repo`; (5) insert one `agent_runs` row with `source = 'ci'`, every column assigned explicitly (nothing spread from the body) — idempotent on the `(ci_installation_id, actions_run_id)` unique index, a duplicate is a no-op success. Responses never echo the token or its hash. Returns `201 { ok: true }`. |

### Reads (Phase C, WI15 — zero GitHub calls, zero LLM calls)

| Method | Path | Behaviour |
|---|---|---|
| `GET` | `/ci/runs` | The workspace's CI runs (`agent_runs.source = 'ci'` only, never local runs), filterable by `CiRunFilters` querystring. Filters are applied **after** the workspace predicate, never instead of it. |
| `GET` | `/agents/:id/ci-installations` | An agent's installations, each with `workflow_version`, `agent_version`, and a nullable last-run summary. 404 outside the caller's workspace. |

### Delete (Phase C, WI16 — not demanded by any AC, added to make E-14's documented remedy executable)

| Method | Path | Behaviour |
|---|---|---|
| `DELETE` | `/ci/installations/:id` | Workspace-scoped through the `agents` join. `404` if not in this workspace. Deletes the installation row; `agent_runs.ci_installation_id` is `ON DELETE SET NULL`, so past CI runs stay readable. Performs no GitHub call — the committed workflow keeps running and its reports simply start being rejected with `401`. There is no token-rotation route; the documented remedy for a leaked token is delete-and-re-export. |

**`Fail CI on` needs no dedicated route.** `agents.ci_fail_on` is already
writable through the existing agent-update path
(`contracts/knowledge.ts`, `client/src/lib/hooks/agents.ts`'s
`useUpdateAgent`) — the CI tab reuses it rather than adding a second one.

## `CiTarget` / `CiRunStatus`

Source: `server/src/vendor/shared/contracts/eval-ci.ts` (hand-mirrored to
`client/src/vendor/shared/contracts/eval-ci.ts`, byte-identical — root
`AGENTS.md`).

- `CiTarget = z.enum(['gha', 'circle', 'jenkins', 'cli'])` — the contract
  keeps all four so the UI can render the three disabled cards; every route
  rejects anything but `'gha'` at the handler, not at the schema.
- `CiRunStatus = z.enum(['succeeded', 'failed', 'no_findings', 'running'])`.

## `CiFile`

| Field | Type | Notes |
|---|---|---|
| `path` | `string` | |
| `contents` | `string` | |
| `editable` | `boolean`, default `true` | Only the workflow file is ever `true` in a real response. |
| `preview_omitted` | `boolean`, default `false` | `true` only for the runner-bundle entry on Preview — `contents` is a size placeholder there; the real bytes are supplied server-side at Install/zip, never sent to or received from the client. |

## `AgentManifest`

The one schema both the studio (write) and `agent-runner` (read) validate
against — kept identical on both ends so the formats never drift.

| Field | Type | Notes |
|---|---|---|
| `name` | `string` | |
| `provider` | `Provider`, default `'openrouter'` | Always written as `'openrouter'` regardless of the agent's own studio `provider` — the runner constructs `OpenRouterProvider` unconditionally (`agent-runner/src/index.ts:39`). |
| `model` | `string` | Verbatim from `agents.model` — no mapping, no namespacing heuristic. |
| `system_prompt` | `string` | |
| `skills` | `string[]` | Ordered slugs of enabled linked skills; missing/`null` normalizes to `[]`. |
| `strategy` | `'auto' \| 'single-pass' \| 'map-reduce'`, default `'auto'` | |
| `ci_fail_on` | `CiFailOn`, default `'critical'` | The **only** channel the CI gate policy reaches the workflow through — no fail-on value is ever emitted into the generated workflow itself. |

## `CiExportInput`

Request body for `POST /agents/:id/export-ci{,/preview,/zip}`:

| Field | Type | Notes |
|---|---|---|
| `repo` | `string` | `"owner/name"` — server-validated with a strict pattern before use in any path/branch/commit-message. |
| `target` | `CiTarget`, default `'gha'` | Route rejects anything but `'gha'`. |
| `action` | `'open_pr' \| 'files'`, default `'open_pr'` | |
| `post_as` | `'github_review' \| 'pr_comment' \| 'none'`, default `'github_review'` | |
| `triggers` | `string[]`, default `['opened','synchronize','reopened']` | Intersected against `ALLOWED_TRIGGERS` server-side regardless of what's sent. |
| `base` | `string`, default `'main'` | |
| `workflow_override` | `string \| null \| undefined` | The **only** generated file the client may submit an edited version of. Re-validated server-side (`workflow-validate.ts`) before commit. |
| `ingest_url` | `string` (URL) | Where the CI job POSTs its result — literal-baked into the generated workflow's reporting step. |
| `replace_existing` | `boolean`, default `false` | Explicit confirmation to replace a different agent's installation on the same repo. |

## `CiInstallation`

Response shape (never carries a token or a hash):

| Field | Type | Notes |
|---|---|---|
| `id` / `agent_id` / `repo` / `target_type` / `installed_at` | | |
| `workflow_version` / `agent_version` | `int` | Recorded at install time — a later agent edit shows up as drift (CI tab compares `agent_version` here to the agent's live `version`). |
| `ingest_url` / `post_as` / `triggers` / `base` | | Echo of the installation's own configured options, so "Update CI config" can re-run with them. |
| `last_run` | `{ ran_at, status, findings_count } \| null` | `null` until the first run is ingested. |

## `CiExport`

Response of `POST /agents/:id/export-ci`:

`{ installation: CiInstallation, files: CiFile[], pr_url: string | null, ingest_token: string | null }`

`ingest_token` is the one-time plaintext — present **only** on the immediate
response of a genuine create, `null` on every update (including "Update CI
config" against the same route) and on every other response shape.

## `CiIngestInput`

Body posted by the CI job to `POST /ci/ingest`:

| Field | Type | Notes |
|---|---|---|
| `result` | `CiResultArtifact \| null` | `null` is the failure-shaped body — the runner's hard-fail path wrote no artifact. |
| `repo` | `string` | Must string-equal the authenticated installation's own `repo`. |
| `head_sha` | `string` | |
| `pr_number` | `int \| null` | |
| `actions_run_id` | `string` | Half of the idempotency key (with the installation id). |
| `job_url` | `string` (URL) | Persisted as `CiRun.github_url` — the only ground-truth link for a CI row; there is no run trace. |
| `source` | `string`, 1–64 chars | Free-form, deliberately **unvalidated** against `CiTarget` — display data only, never branched on. The shipped generator always sends `'github_actions'`. |
| `status` | `CiRunStatus` | Derived by the workflow's reporting step from the artifact's own `findings_count`, not from the review step's exit code. |
| `duration_ms` | `int \| null` | |
| `error` | `string \| null \| undefined` | |

## `CiResultArtifact`

Unchanged from the eval pipeline's shape — `{ findings_count, critical?,
warning?, suggestion?, cost_usd, duration_ms?, agent, version?, pr_number? }`
(`eval-ci.ts:475-486`). The severity fields are nullish; the CI Runs page
falls back to the total `findings_count` when they're absent, never
rendering a fabricated `0`.

## `CiRun`

Read shape for the CI Runs page, served from `agent_runs`:

| Field | Type | Notes |
|---|---|---|
| `id` / `ci_installation_id` | | `ci_installation_id` is `null` for an orphaned run (its installation was deleted). |
| `pr_number` / `head_sha` / `repo` / `pr_title` | nullable | Denormalized onto the run row — a CI run's PR may never be imported into DevDigest locally, so `pr_id` stays `null` and these fields keep the row interpretable without one. |
| `ran_at` | `string \| null` (ISO) | |
| `status` | `string \| null` | The four `CiRunStatus` values. |
| `findings_count` | `int \| null` | |
| `critical` / `warning` / `suggestion` | `int \| null` | Each independently nullable — an unknown split renders as absent, never `0`. |
| `cost_usd` / `duration_s` | `number \| null` | |
| `github_url` | `string \| null` | Reused as the CI **job** URL (there's no trace to link back to). |
| `source` | `string \| null` | The reported label (`"github_actions"`, or anything else a valid-token caller sends) — distinct from `agent_runs.source`'s `'local'\|'ci'` enum, which is the page's filter predicate, not this field. |
| `agent` / `agent_id` | nullable | `agent` is the agent's name at read time; `agent_id` survives an agent deletion as `null` (`agent_runs.agent_id` is `ON DELETE SET NULL`). |

## `CiRunFilters`

Querystring for `GET /ci/runs`: `{ since_days: int, default 7; agent_id?,
repo?, status?, source?: string | null }`. `since_days` coerces from the
querystring; the other four narrow an already-fetched, time-windowed set.

## Persistence

- **`ci_installations`** (`server/src/db/schema/ci.ts`) — `agent_id` (FK,
  `onDelete: 'cascade'`), `repo`, `target_type`, `token_hash` (`sha256(token)`,
  never the plaintext — plain-indexed, not unique, since the hash match
  itself is the auth), `ingest_url`, `workflow_version`, `agent_version`,
  `post_as`, `triggers` (jsonb), `base_branch`, `manifest_path` (a stable,
  persisted path — set once and reused on every re-export, never re-derived
  from the agent's current name, so a renamed agent never leaves two
  manifest files in the target tree), `updated_at`. Unique index on
  `(agent_id, repo)` (AC-38's "update, don't duplicate", enforced by the
  database). No `workspace_id` column — every query that needs tenancy joins
  through `agents.workspace_id`, except the ingest path's own lookup by
  `token_hash`, which is the tenancy derivation for that one path.
- **`ci_runs`** — deliberately **not written**. Left in place as dead
  scaffolding; `agent_runs` with `source = 'ci'` is the single CI run store.
  A doc comment above the table in `ci.ts` records this so a future reader
  doesn't "helpfully" wire it up.
- **`agent_runs`** (`server/src/db/schema/runs.ts`) gains, all nullable:
  `ci_installation_id` (FK, `onDelete: 'set null'`), `external_pr_number`,
  `head_sha`, `actions_run_id`, `job_url`, `source_label`, `critical`,
  `warning`, `suggestion`. Unique index on `(ci_installation_id,
  actions_run_id)` for ingest idempotency (both columns are `NULL` for local
  runs, and Postgres treats `NULL`s as distinct, so local rows are
  unaffected). Index on `(workspace_id, source, ran_at)` for the CI Runs
  list's scan.

## Engineering caps

`server/src/modules/ci/constants.ts` — the single source of truth every
generator invariant and the re-validator both read from:

| Constant | Value | Purpose |
|---|---|---|
| `RUN_COMMAND` | `'node .devdigest/runner/index.js'` | The exact, only permitted review-step command. |
| `FORBIDDEN_EVENTS` | `pull_request_target`, `issue_comment`, `pull_request_review_comment`, `workflow_run`, `workflow_dispatch` | Never emitted, under any trigger/`post_as` combination. |
| `ALLOWED_TRIGGERS` | `opened`, `synchronize`, `reopened` | The only `pull_request` activity types the generator will emit. |
| `PERMISSIONS_POST` / `PERMISSIONS_NO_POST` | `{contents:read, pull-requests:write}` / `{..., pull-requests:read}` | Workflow-level only — no job-level override is ever emitted. |
| `FORK_GUARD_EXPR` | `github.event.pull_request.head.repo.full_name == github.repository` | Shared byte-for-byte by generator and validator. |
| `PINNED_ACTIONS` | `checkout@11bd719...` (v4.2.2), `setup-node@49933ea...` (v4.4.0) | Resolved via `git ls-remote --tags` on 2026-08-23; refreshing means re-running that command, never guessing a SHA. |
| `NODE_VERSION` | `'22'` | Matches the runner's own documented floor. |
| `CI_BRANCH` | `'devdigest/ci'` | Install's target branch — never the base branch. |
| `WORKFLOW_VERSION` | `1` | Bumped by hand whenever `workflow.ts` changes its output shape. |
| `INGEST_TOKEN_BYTES` | `32` (256 bits) | CSPRNG token size. |
| `EXPORT_RATE_LIMIT` | `{ max: 10, timeWindow: '1 minute' }` | `POST /agents/:id/export-ci{,/zip}` — matches `modules/reviews/routes.ts`'s existing GitHub-writing routes. |
| `INGEST_RATE_LIMIT` | `{ max: 60, timeWindow: '1 minute' }` | `POST /ci/ingest`. |
| `MAX_INGEST_BODY_BYTES` | `256 * 1024` | Well under the server's global 1 MB `bodyLimit`. |
