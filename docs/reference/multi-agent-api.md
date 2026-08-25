# Multi-Agent Review API & contracts

Stable lookup for the shipped Multi-Agent Review HTTP surface and Zod shapes.
For behaviour and design, see
[`docs/features/multi-agent-review.md`](../features/multi-agent-review.md).

## HTTP

Routes live in `server/src/modules/reviews/routes.ts` unless noted. Every
handler resolves tenancy via `getContext(container, req)` before any work; a
resource id outside the caller's workspace 404s (never a partial leak).

| Method | Path | Behaviour |
|---|---|---|
| `POST` | `/pulls/:id/multi-agent-run` | Body `{ agent_ids: string[] }` — non-empty, `.uuid()`-validated, capped at `MAX_MULTI_AGENT_BATCH_SIZE = 50` (`constants.ts`) at the route's zod schema, before the handler runs. Every id is verified to belong to the caller's workspace **before any row is created** (zero partial state on rejection). Creates one `multi_agent_runs` parent + N `agent_runs` children and returns immediately — runs execute in the background. Rate limit: **10/minute**, same as `POST /pulls/:id/review`. A duplicate id in the array 400s. |
| `GET` | `/multi-agent-runs/:id` | The `MultiAgentRun` shape below — columns, derived `groups`, derived `conflicts`. Addresses one **specific** batch id; never "the latest batch for this PR." Unknown/foreign batch id → 404. |
| `GET` | `/agents/stats` | One batched call: every workspace agent's `avg_duration_ms`/`avg_cost_usd`/`sample_size`, each scoped to that agent's **current** model (an agent whose model was recently edited shows nulls, i.e. "no estimate yet," rather than an average mixing two models). Not routing-conflicted with `GET /agents/:id` — Fastify's radix router prefers the static segment. Registered in `server/src/modules/agents/routes.ts`. |
| `POST` | `/findings/:id/learn` | Registered via the existing `FINDING_ACTIONS` loop (`accept`, `dismiss`, `learn`). Writes one `memory` row, returns `{ memory_id }`. Idempotent at the DB level (see [Persistence](#persistence)). |
| `POST` | `/findings/:id/eval-case` | Registered **separately** — `'eval-case'` is not a `FindingActionKind` member and none was added. Creates one `eval_cases` row, returns `{ eval_case_id }`. Idempotent at the DB level. |
| `POST` | `/pulls/:id/review` | reuse, unchanged | single-agent / "run all enabled" path; `RunReviewDropdown` still calls this. |
| `GET` | `/runs/:id/events` (SSE) | reuse, unchanged | one stream per child run id — a Columns card subscribes to exactly its own `run_id`. |
| `POST` | `/runs/:id/cancel` | reuse, unchanged, per-run only | no "cancel the whole batch" affordance; cancelling one child never cancels siblings. |
| `POST` | `/findings/:id/accept\|dismiss` | reuse, unchanged | acts on one finding id; never ripples to a group's siblings. |

## `MultiAgentRun`

Source: `vendor/shared/contracts/observability.ts` (hand-mirrored server ↔
client). Response of `GET /multi-agent-runs/:id` (and the seed value
`POST /pulls/:id/multi-agent-run` returns, with every column still
`'running'`).

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | The `multi_agent_runs` parent id. |
| `pr_id` / `pr_number` | `string` / `int \| null` | |
| `ran_at` | `string` (ISO) | Parent row's creation time. |
| `agent_count` | `int` | Number of child `agent_runs`. |
| `total_duration_ms` | `int` | **Wall-clock span**: first child start → last child finish. Never a sum of per-child durations. A child with no known `duration_ms` yet contributes "now" as its provisional finish, so this keeps growing while the batch is in flight. |
| `total_cost_usd` | `number \| null` | Sum of every child's known `cost_usd`; `null` only when **no** child has a known cost. |
| `total_cost_partial` | `boolean` | `true` when at least one child's `cost_usd` is null — the total is an under-count, not a fabricated complete sum (default `false`, added in this feature). |
| `columns` | `AgentColumn[]` | One per child run. |
| `groups` | `FindingGroup[]` | Derived, never persisted — added in this feature. |
| `conflicts` | `Conflict[]` | Derived, never persisted; **unfiltered** — every shared location, not just genuine conflicts (a client toggle narrows further; see the feature doc). |

## `AgentColumn`

| Field | Type | Notes |
|---|---|---|
| `run_id` / `agent_id` / `agent_name` | `string` | |
| `provider` / `model` | `string \| null` | |
| `status` | `'done' \| 'failed' \| 'running' \| 'cancelled'` | `'cancelled'` added in this feature (`agent_runs.status` already had it; the contract didn't). |
| `verdict` / `score` / `summary` | mixed, nullable | Unchanged shape. |
| `error` | `string` nullish | **New in this feature.** Populated only when `status` is `'failed'` or `'cancelled'`, carrying the persisted `agent_runs.error` text. `summary` is never overloaded to carry this — it only ever holds a genuine review summary. `.nullish()` (not `.nullable()`) so every pre-existing hand-built `AgentColumn` object literal in tests/fixtures stays valid without the field. |
| `duration_ms` / `cost_usd` | `number \| null` | Per-child measured values. |
| `findings` | `AgentColumnFinding[]` | Unchanged shape. |

## `FindingGroup` / `FindingGroupMember` (new)

| Field (`FindingGroup`) | Type | Notes |
|---|---|---|
| `file` / `normalized_file` | `string` | `normalized_file` exists only for the grouping match (backslash → forward slash, strip leading `./`) — never used for filesystem access. |
| `start_line` / `end_line` | `int` | Min/max across the group's members. |
| `category` | `FindingCategory` | Groups require an **exact** category match — a same-line, different-category pair is a shared *location* for conflicts, but never a group. |
| `members` | `FindingGroupMember[]` | One per contributing finding, **verbatim** — never merged/paraphrased. |

| Field (`FindingGroupMember`) | Type | Notes |
|---|---|---|
| `id` / `run_id` / `agent_id` / `agent_name` | `string` | |
| `severity` | `Severity` | |
| `title` / `rationale` | `string` | Verbatim from the underlying `Finding` row. |
| `suggestion` | `string` nullish | |
| `confidence` | `number` (0–1) | |

A finding flagged by exactly one agent still comes back as a `FindingGroup`
with one member — grouping never suppresses a finding.

## `Conflict` / `ConflictTake`

Unchanged shapes (both pre-authored ahead of this feature), reused as-is:

| Field (`Conflict`) | Type | Notes |
|---|---|---|
| `file` / `line` | `string` / `int` | One contended location. |
| `title` | `string` | Taken from whichever participating finding hit first. |
| `takes` | `ConflictTake[]` | One per **participating** (`status === 'done'`) agent — a `failed`/`cancelled` run is excluded outright, never given an `'ignored'` take. |

| Field (`ConflictTake`) | Type | Notes |
|---|---|---|
| `agent_id` / `persona` | `string` | |
| `verdict` | `Severity \| 'ignored'` | `'ignored'` = this agent completed the run and did not flag this exact location — a first-class state, not an omission. |
| `note` | `string` | The finding's own rationale, or `"Not flagged by this agent."` for an `'ignored'` take. |

A location is emitted by the server whenever **any** participating agent
flagged it — including a location every agent agreed on. The client's own
"Show only conflicts" toggle narrows further (see the feature doc); the
server does not pre-filter.

## `AgentCostEstimate` (server-local, not vendored)

Response shape of `GET /agents/stats`. Deliberately **not** the vendored
`AgentStats` contract (`observability.ts`) — that is `GET /agents/:id/stats`'s
richer per-agent-detail response (accept-rate, findings-by-severity, trend).
Defined in `server/src/modules/agents/helpers.ts` and mirrored field-for-field
by a local interface in `client/src/lib/hooks/multi-agent.ts` (not imported
from a shared contract).

| Field | Type | Notes |
|---|---|---|
| `agent_id` / `agent_name` | `string` | |
| `avg_duration_ms` | `number \| null` | `null` when the agent has no completed run under its **current** model. |
| `avg_cost_usd` | `number \| null` | Same scoping. |
| `sample_size` | `int` | `0` when there is no completed run under the current model. |

## Persistence

- **`agent_runs.multi_agent_run_id`** — nullable `uuid` FK to
  `multi_agent_runs(id)`, `onDelete: 'set null'`, plus a plain index
  (`agent_runs_multi_agent_run_id_idx`). Nullable because every pre-existing
  single-agent run has no parent. Migration: `0019_soft_spirit.sql`.
- **`eval_cases.owner_kind`** — text-enum widened from `['skill','agent']` to
  `['skill','agent','finding']`, plus a new unique index
  `eval_cases_ws_owner_uq` on `(workspace_id, owner_kind, owner_id)` — the
  idempotency guarantee for "Turn into eval case" is a **database**
  constraint, not just an app-level check-then-insert (`insertEvalCase`
  catches the resulting `unique_violation` and re-fetches the winning row).
  Migration: `0020_aberrant_captain_cross.sql`.
- **`memory.learned_finding_id`** — nullable `uuid`, plus a unique index
  `memory_learned_finding_uq`. Set only on a row created by the Learn action;
  `null` for every other memory row (manual entries, curator merges). A plain
  (non-partial) unique index is correct here because Postgres treats `NULL`s
  as pairwise-distinct under a standard unique index — no `WHERE`-clause
  index was needed. Same catch-and-re-fetch idempotency pattern as
  `eval_cases`. Migration: `0020_aberrant_captain_cross.sql`.
- **`memory.embedding`** — unchanged column, always written `null` by Learn;
  the embedder (`container.embedder()`) is never called by this feature.

## Engineering caps

`server/src/modules/reviews/constants.ts`:

| Constant | Value | Purpose |
|---|---|---|
| `MULTI_AGENT_CONCURRENCY` | `3` | `p-queue` concurrency for the fan-out — matches `platform/jobs.ts`'s `JobRunner` default. Not a cap on batch size. |
| `MAX_MULTI_AGENT_BATCH_SIZE` | `50` | Defensive DoS/sanity cap on `POST /pulls/:id/multi-agent-run`'s `agent_ids` array length, enforced at the route's zod schema. The real business-rule cap ("max agents per batch = the workspace's own agent count") is enforced separately in `MultiAgentService.runBatch`, since every id must resolve to a real agent in the caller's workspace. |
| `MAX_DIFF_CACHE_ENTRIES` (`diff-loader.ts`) | `16` | Bounded, oldest-out in-memory cache for `loadDiff`, keyed by `` `${pull.id}:${pull.headSha}` `` — coalesces the N per-agent diff loads a batch would otherwise make into one. A failed load is evicted immediately so a subsequent retry isn't poisoned. |

## Rate limiting

`POST /pulls/:id/multi-agent-run`: `{ max: 10, timeWindow: '1 minute' }` — at
least as strict as `POST /pulls/:id/review`'s existing limit, because one call
here fans out to N expensive LLM runs instead of one. Disabled under
`NODE_ENV=test` (root convention, `server/AGENTS.md`).
