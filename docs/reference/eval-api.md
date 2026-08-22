# Eval Pipeline API & contracts

Stable lookup for the shipped Eval Pipeline HTTP surface and Zod shapes. For
behaviour and design, see
[`docs/features/eval-pipeline.md`](../features/eval-pipeline.md).

## HTTP

Routes live in `server/src/modules/eval/routes.ts`. Every handler resolves
tenancy via `getContext(app.container, req)` before any work (AC-42).

### Case CRUD + create-from-finding (Phase B)

| Method | Path | Behaviour |
|---|---|---|
| `GET` | `/agents/:id/eval-cases` | An agent's eval cases, workspace-scoped. 404 if the agent isn't in this workspace. |
| `GET` | `/eval-cases/:id` | One case. A corrupt `expected_output` degrades to `expectation_status: 'unusable'` rather than throwing. |
| `POST` | `/eval-cases` | Create. Body: `EvalCaseInput` extended with `owner_kind: z.literal('agent')` (D-9 — the contract enum still carries `'skill'`, unimplemented). `owner_id` is verified against `AgentsService` before write (AC-43, the worst IDOR surface here). |
| `PATCH` | `/eval-cases/:id` | Partial update — every `EvalCaseInput` field optional. |
| `DELETE` | `/eval-cases/:id` | Delete. |
| `POST` | `/findings/:id/eval-case` | One-click create-from-finding. Body: `EvalCaseFromFindingInput` (an optional `name` only — everything else server-derived). Registered by the eval module, not `modules/reviews` (route-prefix-doesn't-imply-module-ownership). Refuses (422, writes nothing) on: a finding neither accepted nor dismissed, a review with no `agent_id`, or a file with no stored `pr_files.patch`. 404 on a cross-workspace finding. |

### Batch runner (Phase C, WI7)

| Method | Path | Behaviour |
|---|---|---|
| `POST` | `/agents/:id/eval-runs` | Runs the agent's **whole** case set as one version-pinned batch (AC-14). 422 if the agent has zero cases, or more than `MAX_CASES_PER_BATCH` (25). 409 if a batch is already running for this agent (in-process guard, E-14). Rate-limited **10/minute** (`EVAL_RUN_RATE_LIMIT`). Returns the closed `EvalBatchRecord`, `201`. |
| `POST` | `/eval-cases/:id/run` | Runs **one** case as a one-case batch — same pin/isolate/aggregate invariants as the whole-set run. Rate-limited 10/minute. Returns `EvalBatchRecord`, `201`. |

### Read APIs (Phase C, WI8 — zero LLM calls)

| Method | Path | Behaviour |
|---|---|---|
| `GET` | `/agents/:id/eval-dashboard` | Per-agent `EvalDashboard` — current metrics, delta vs the previous batch, trend, recent batches. |
| `GET` | `/eval-dashboard` | Workspace-wide — one `EvalDashboard` entry per owner (agent) that has **either** a case or a batch in this workspace (E-15 — an owner keeps its history after every case is deleted). |
| `GET` | `/agents/:id/eval-batches` | An agent's batch history, most recent first (rows are **batches**, not per-case runs — D-3). |
| `GET` | `/eval-batches/:id` | One batch plus its per-case `eval_runs` rows. Workspace-scoped through the batch row. 404 if not in this workspace. |
| `GET` | `/agents/:id/eval-compare?base=<id>&head=<id>` | `EvalComparison` between two of this agent's batches — deltas, cost delta, both batches' pinned system prompts. 404 if either batch id isn't this agent's, in this workspace. |

## `EvalExpectationEntry` / `EvalExpectation`

Source: `server/src/vendor/shared/contracts/eval-ci.ts` (hand-mirrored to
client, byte-identical — root `AGENTS.md`).

| Field | Type | Notes |
|---|---|---|
| `file` | `string` | |
| `start_line` / `end_line` | `int >= 0` | |
| `match_scope` | `'range' \| 'file'`, default `'range'` | `'file'` skips the line-range check — derived server-side from the source finding's `kind` at case-creation time for the four `FULL_FILE_KINDS` (Q-6); defaults to `'range'` for a hand-authored case. |
| `severity` / `category` / `title` | optional `string` | Advisory/display only — never affect matching (AC-12). |
| `source_finding_id` | optional `string` | Provenance. |

`EvalExpectation = { version: z.literal(1), must_find: EvalExpectationEntry[], must_not_flag: EvalExpectationEntry[] }`
— the `version` discriminator lets a legacy/corrupt row degrade honestly on
read instead of crashing (AC-13).

## `EvalCaseInput` / `EvalCaseFromFindingInput` / `EvalCaseRecord`

| Contract | Shape |
|---|---|
| `EvalCaseInput` | `{ owner_kind, owner_id, name, input_diff (default ''), input_files?, input_meta?, expected_output: EvalExpectation, notes? }` |
| `EvalCaseFromFindingInput` | `{ name?: string }` — the finding id travels as a route param, not a body field. |
| `EvalCaseRecord` (read shape) | `EvalCaseInput`'s fields plus `id`, `input_status: 'ok'\|'unusable'` (degradation for `input_meta`/`input_files`), `expected_output: EvalExpectation \| null`, `expectation_status: 'ok'\|'unusable'`. |

`EvalCaseInputMeta = { title: string, body: string }` — typed (not
`z.unknown()`) because the batch runner reads `input_meta.body` straight into
an LLM prompt; an unvalidated shape reaching a model call is treated the same
stored-content risk `expected_output` already gets a schema for.

## `EvalRunRecord`

One persisted `eval_runs` row, as returned by the API:

| Field | Type | Notes |
|---|---|---|
| `id` / `case_id` | `string` | |
| `case_name` | `string \| null \| undefined` | Left-joined from the case's **current** name; `null` only if the case row is somehow gone despite the cascade-delete relationship. |
| `batch_id` | `string \| null` | Nullable — `ON DELETE SET NULL` when a batch row is deleted. |
| `ran_at` | `string` (ISO) | |
| `actual_output` | `unknown` | The model's raw review output for this case. |
| `pass` | `boolean \| null` | `null` when the case had no usable expectation to score against. |
| `recall` / `precision` / `citation_accuracy` | `number \| null` | `null`, never `1.0`/`0`, when the metric is undefined for this case (AC-24/25/27). |
| `findings_total` | `int \| null` | Raw finding count including unjudged findings (AC-26). |
| `duration_ms` / `cost_usd` | `number \| null` | `cost_usd` null when the provider didn't report cost (E-16). |
| `error` | `string \| null \| undefined` | Set only when the case failed to execute (AC-20). |

## `EvalBatchRecord`

One persisted `eval_batches` row — one version-pinned execution of an
owner's whole case set (D-3):

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | |
| `owner_kind` / `owner_id` | `EvalOwnerKind` / `string` | D-9 — only `'agent'` is ever written this iteration. |
| `agent_version` | `int` | Pinned at batch open (AC-15/16). |
| `provider` / `model` | `string` | As actually used for this batch. |
| `skills_fingerprint` | `{ skill_id, version }[]` | Ordered, enabled linked skills at batch start — makes a skill-only edit visible even though it doesn't bump `agents.version` (Q-3/E-8). Missing/`null` normalizes to `[]`. |
| `ran_at` | `string` (ISO) | Captured at batch-**open** time, before any case ran — even though the row itself is written only once the batch finishes. |
| `status` | `'completed' \| 'failed'` | `'failed'` only when every case failed to execute (AC-21) — never a partial-failure state. |
| `cases_total` / `cases_passed` / `cases_failed` | `int` | |
| `recall` / `precision` / `citation_accuracy` | `number \| null` | Unweighted mean over non-null per-case values; `null` if no case contributed. |
| `recall_cases` / `precision_cases` / `citation_cases` | `int` | How many cases actually contributed to each mean (AC-30) — so a mean over 2 of 8 cases isn't misread as a mean over 8. |
| `findings_total` | `int \| null` | Summed only over cases that actually ran; `null` if none did. |
| `duration_ms` | `int \| null` | |
| `cost_usd` | `number \| null` | `null` unless **every** contributing case's cost is known — a partial sum would understate spend. |
| `error` | `string \| null \| undefined` | Set on an all-failed batch. |

## `EvalComparison`

`{ base: EvalBatchRecord, head: EvalBatchRecord, delta: { recall, precision, citation_accuracy, cost_usd } (each nullable), base_prompt: string | null, head_prompt: string | null }`

Both prompts are read from `agent_versions.config_json` snapshots via
`AgentsService.getVersion` — a missing snapshot for a recorded
`agent_version` degrades to a `null` prompt, **never** the agent's current
prompt (AC-32). Every delta field is `null` when either side's own metric is
null, not a fabricated swing.

## `EvalTrendPoint` / `EvalDashboard`

`EvalTrendPoint = { batch_id, agent_version, ran_at, recall, precision, citation_accuracy (each nullable), pass_rate: number, cost_usd: number | null }`
— one point **per batch**, oldest first.

`EvalDashboard`:

| Field | Type | Notes |
|---|---|---|
| `owner_kind` / `owner_id` | nullable | |
| `cases_total` | `int` | |
| `current` | `{ recall, precision, citation_accuracy, cost_usd (nullable), traces_passed, traces_total }` | From the latest batch; all-null current if there's no batch yet. |
| `delta` | `{ recall, precision, citation_accuracy } \| null`, each field independently nullable | `null` as a whole block when there are fewer than two batches (E-17). **Revised in the Phase C fix-loop** (was: non-nullable per-field, silently fabricating `0` for an unmeasured metric on either side once ≥2 batches existed) — see the feature doc's "Reading" section. |
| `trend` | `EvalTrendPoint[]` | Oldest first. |
| `recent_runs` | `EvalBatchRecord[]` | Rows are batches (D-3), not per-case runs. |
| `alert` | `string \| null` | Not computed this iteration — no threshold/condition is specified; always `null` rather than an invented signal. |

## Persistence

Tables: `server/src/db/schema/eval.ts` → `evalCases`, `evalBatches`,
`evalRuns`. `evalBatches.workspaceId` is the tenancy anchor `evalRuns` lacks;
every read of a run is therefore scoped through its case's or batch's
`workspace_id`, never by run id alone (AC-44). `evalRuns.batchId` is nullable,
`ON DELETE SET NULL`. See
[ADR 0006](../adr/0006-eval-batches-stored-aggregate.md) for why the batch's
aggregate is a stored, immutable snapshot rather than a live derivation from
`eval_runs`, and its 2026-08-21 addendum for the atomic-transaction write
mechanism.

## Engineering caps

`server/src/modules/eval/constants.ts`:

| Constant | Value | Purpose |
|---|---|---|
| `MAX_INPUT_DIFF_BYTES` | `256_000` | Case `input_diff` size cap on write (AC-46) — comfortably under the app's 1 MB `bodyLimit`. |
| `MAX_CASES_PER_BATCH` | `25` | Bounds one batch's worst-case spend (A06/Q-4). |
| `EVAL_CASE_TIMEOUT_MS` | `120_000` | Per-case timeout via `withTimeout` — a timeout is a failed case (AC-20), not a failed batch. |
| `EVAL_RUN_RATE_LIMIT` | `{ max: 10, timeWindow: '1 minute' }` | Both run routes (AC-45), same rate as other model-spending routes. |
| `FULL_FILE_KINDS` | `{secret_leak, lethal_trifecta, phantom, hook}` | Finding kinds that derive `match_scope: 'file'` at case creation — duplicated from `reviewer-core/src/grounding.ts`'s module-private constant (Q-6), never imported. |
