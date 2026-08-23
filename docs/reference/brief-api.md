# PR Brief API & contracts

Stable lookup for the shipped PR Brief & Why Timeline HTTP surface and Zod
shapes. For behaviour and design, see
[`docs/features/pr-brief.md`](../features/pr-brief.md).

## HTTP

Routes live in `server/src/modules/brief/routes.ts`. Every handler resolves
tenancy via `getContext(app.container, req)` before any work and responds 404
for a PR outside the caller's workspace — including the timeline (list)
route.

| Method | Path | Behaviour |
|---|---|---|
| `GET` | `/pulls/:id/brief` | The persisted brief for the PR's **current** `head_sha`, or an honest `stale`/`absent`/`corrupt` state. Never a model call. Unknown PR → 404. |
| `POST` | `/pulls/:id/brief/generate` | Body `{ head_sha: string, force?: boolean }`. Refuses (`409 ConflictError`) any `head_sha` other than the PR's current one, zero calls. Without `force`, reuses an existing row for that SHA with zero calls. With `force`, or when no row exists, makes exactly one structured LLM call. Rate limit: **10/minute**, same as `reviews/routes.ts` (disabled under `NODE_ENV=test` unless the harness is stood up with `nodeEnv: 'production'`). Unknown PR → 404. |
| `GET` | `/pulls/:id/brief/timeline` | Every persisted brief for the PR, newest first, capped at `MAX_TIMELINE_ENTRIES = 50`. Each entry carries its **full** `BriefRecord` inline (not a summary) — "two endpoints, not three." Never a model call. Unknown PR → 404. |

## Feature model

| Id | Default provider | Default model |
|---|---|---|
| `risk_brief` | `openai` | `gpt-4.1` |

Defined in both vendored `contracts/platform.ts` copies. Resolved via
`resolveFeatureModel(container, workspaceId, 'risk_brief')` — no new settings
UI. Note this default is a **premium** model, unlike `review_intent`'s flash
default, which is what makes the cache contract (zero calls on every read)
a cost control rather than a nicety.

## `Brief` / `ReviewFocusItem`

Source: `server/src/vendor/shared/contracts/brief.ts` (hand-mirrored to
client).

| Field | Type | Notes |
|---|---|---|
| `what` | `string` | One or two sentences on what the PR changes. |
| `why` | `string` | One or two sentences on why, grounded in the given inputs. |
| `risk_level` | `RiskSeverity` (`'high'\|'medium'\|'low'`) | Model's overall judgement — distinct from, and never merged into, the deterministic review score. |
| `risks` | `Risk[]` | Reuses the existing `Risk` shape (`kind`/`title`/`explanation`/`severity`/`file_refs`) unchanged. Capped at `MAX_RISKS = 6` after grounding. |
| `review_focus` | `ReviewFocusItem[]` | New shape (`path`, `line: int`, `reason`) — `Risk.file_refs` has no line number and no per-item reason, which is why it couldn't be reused for this. Capped at `MAX_FOCUS_ITEMS = 5` after grounding. |

`review_focus[].path`/`.line` and each `risks[].file_refs` entry are
re-verified against the PR's real changed-file set and hunk ranges in code
after the call (see [Grounding](../features/pr-brief.md#grounding)) — never
trusted as-is from the model.

## `BriefInputStatus` / `BriefUsage`

Source: `server/src/vendor/shared/contracts/review-api.ts`.

`BriefInputStatus` — what a generation's inputs actually looked like, backing
the card's collapsed "Inputs" disclosure:

| Field | Type | Notes |
|---|---|---|
| `intent_status` | `'used'\|'missing'\|'stale'` | `stale` when the persisted intent record's `head_sha` doesn't match the PR's current head. |
| `blast_status` | `'full'\|'partial'\|'degraded'` | Mirrors `BlastRadiusResponse.status`. |
| `changed_file_count` | `int` | |
| `spec_files_used` | `string[]` | Resolved `.md` refs actually read and admitted. |
| `spec_files_unresolved` | `string[]` | Refs that escaped the clone, were deleted, or had no clone to read from. |
| `linked_issue_status` | `'used'\|'unresolved'\|'not_referenced'` | |
| `dropped_inputs` | `string[]` | Human strings naming which whole **inputs** the 8 000-token budget dropped (e.g. `"spec file docs/x.md dropped (spec sub-cap)"`). Distinct from `BriefUsage`'s grounding-drop counts, which are about the model's *output*. |

`BriefUsage` — generation usage/cost plus grounding-drop counts:

| Field | Type | Notes |
|---|---|---|
| `provider` / `model` | `string` | |
| `input_tokens` | `int` | Pre-call measurement this module made itself (AC-23) — always present once a generation succeeds. |
| `tokens_in` / `tokens_out` | `int \| null` | Provider-reported; nullable. |
| `cost_usd` | `number \| null` | Nullable — a provider that doesn't report cost must not render as free. |
| `dropped_risk_refs` / `dropped_focus_items` | `int` | How many `risks[].file_refs`/`review_focus[]` entries were discarded by grounding (before the `MAX_RISKS`/`MAX_FOCUS_ITEMS` render cap). |

## `BriefRecord`

`Brief.extend({ pr_id, head_sha, generated_at, input_status: BriefInputStatus, usage: BriefUsage })`
— the `Brief` plus everything needed to render/audit it.

## `BriefState` — persisted read states vs transient generate outcomes

```
'current' | 'stale' | 'absent' | 'corrupt' | 'budget_exceeded' | 'failed'
```

| State | Kind | Meaning |
|---|---|---|
| `current` | persisted (read) | A brief exists for the PR's current `head_sha`. |
| `stale` | persisted (read) | The current `head_sha` has no brief, but an earlier SHA does — `record` describes that earlier commit. |
| `absent` | persisted (read) | No brief has ever been generated for this PR. |
| `corrupt` | persisted (read) | A row exists but failed re-validation against the stored-json contract on read (schema drift / hand-corrupted data). |
| `budget_exceeded` | transient (generate-only) | The floor alone (title + intent + blast summary) exceeded 8 000 tokens — zero calls made, nothing persisted. |
| `failed` | transient (generate-only) | The provider threw, or the response failed schema validation after the adapter's own retries — nothing persisted, any prior row for that SHA left untouched. |

The transient pair is returned only by `POST …/generate`, always with
`record: null`, and is **never persisted** — by construction there is no row
to read either state back from on a later `GET`. See
[the feature doc's `BriefState` section](../features/pr-brief.md#the-briefstate-split--persisted-read-states-vs-transient-generate-outcomes)
for the client-side bug this split's enforcement had, and its fix.

## `BriefResponse`

Shared shape for `GET /pulls/:id/brief` and `POST /pulls/:id/brief/generate`:

| Field | Type | Notes |
|---|---|---|
| `state` | `BriefState` | |
| `current_head_sha` | `string` | The PR's current head SHA at response time. |
| `record` | `BriefRecord \| null` | `null` for `absent`/`corrupt`/`budget_exceeded`/`failed`. |
| `reused` | `boolean` | `true` when no model call was made this invocation (every `GET`; a `POST` that hit an existing row without `force`). |
| `reason` | `string \| null` | Human explanation for a non-`current` state; `null` only when `state === 'current'`. |

## `BriefTimelineEntry` / `BriefTimelineResponse`

| Field (`BriefTimelineEntry`) | Type | Notes |
|---|---|---|
| `head_sha` | `string` | |
| `generated_at` | `string` (ISO) | |
| `risk_level` | `RiskSeverity` | |
| `is_current_head` | `boolean` | |
| `risk_changed` | `boolean` | `true` when this entry's `risk_level` differs from the next-**older** entry's (entries are newest-first). The oldest entry is never marked. |
| `record` | `BriefRecord` | **Full** record, not a summary — activating this entry in the UI costs zero additional requests. |

`BriefTimelineResponse { entries: BriefTimelineEntry[], brief_count: int, commit_count: int }`
— `brief_count`/`commit_count` back the honest-gap disclosure ("3 briefs
generated across 12 commits"); the timeline never implies it covers every
commit.

## Persistence (`pr_brief`)

Table: `server/src/db/schema/reviews.ts` → `prBrief`. Composite primary key
`(pr_id, head_sha)` — one row per (PR, commit), not one row per PR. Columns:
`json jsonb` (the `Brief` fields plus a nested `input_status`, minus
`dropped_inputs` which has its own column), `provider`, `model`,
`inputTokens`, `tokensIn`, `tokensOut`, `costUsd doublePrecision`,
`droppedRiskRefs int default 0`, `droppedFocusItems int default 0`,
`droppedInputs jsonb default '[]'`, `generatedAt timestamptz defaultNow`.
Re-parsed against the module's own stored-json contract on every read *and*
write. See [ADR 0005](../adr/0005-composite-key-brief-persistence.md) for why
this is a composite key rather than a surrogate id.

## Engineering caps

`server/src/modules/brief/constants.ts`:

| Constant | Value | Purpose |
|---|---|---|
| `BRIEF_INPUT_TOKEN_BUDGET` | `8_000` | Hard input-token budget on the fully assembled call. |
| `SPEC_INPUT_TOKEN_SUBCAP` | `2_500` | Spec-file input's own sub-cap, strictly below the total. |
| `MAX_SPEC_FILES` | `2` | Max spec files admitted per generation. |
| `MAX_SPEC_FILE_READ_CHARS` | `40_000` | Pure I/O bound on a single spec-file read — not a content cap. |
| `MAX_TIMELINE_ENTRIES` | `50` | Why Timeline row cap. |
| `MAX_RISKS` | `6` | Render/persist cap on `risks[]` after grounding. |
| `MAX_FOCUS_ITEMS` | `5` | Render/persist cap on `review_focus[]` after grounding. |
| `BRIEF_RATE_LIMIT` | `{ max: 10, timeWindow: '1 minute' }` | Same rate as other model-spending PR routes. |
