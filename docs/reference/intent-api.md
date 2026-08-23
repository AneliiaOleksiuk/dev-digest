# Intent Layer API & contracts

Stable lookup for the shipped Intent Layer HTTP surface and Zod shapes. For
behaviour and design, see [`docs/features/intent-layer.md`](../features/intent-layer.md).

## HTTP

Routes live in `server/src/modules/reviews/routes.ts` (not the `pulls` module —
avoids a `pulls → reviews` dependency for a field only the PR page uses).

| Method | Path | Behaviour |
|---|---|---|
| `GET` | `/pulls/:id/intent` | Persisted `PrIntentRecord`, or `null` with HTTP **200** when unclassified. Unknown PR → 404. |
| `POST` | `/pulls/:id/intent` | Force re-classify; returns `PrIntentRecord`. Rate limit: **10 / minute** (disabled under `NODE_ENV=test`). Unknown PR → 404. |

Neither route declares a reply schema (module pattern: params/body only).

## Feature model

| Id | Default provider | Default model |
|---|---|---|
| `review_intent` | `openrouter` | `deepseek/deepseek-v4-flash` |

Defined in both vendored `contracts/platform.ts` copies and the client runtime
mirror `client/src/lib/feature-models.ts`. Resolved via existing
`resolveFeatureModel(container, workspaceId, 'review_intent')` — no new
settings UI.

## `Intent` / `IntentSource`

Source: `server/src/vendor/shared/contracts/brief.ts` (hand-mirrored to client).

| Field | Notes |
|---|---|
| `intent` | Product name **summary** ≡ this field (not renamed). |
| `in_scope` / `out_of_scope` | `string[]` |
| `confidence` | `0..1`, nullish; server-capped when any source unresolved |
| `sources` | default `[]`; **server-authored** after classify |
| `missing_context` | default `[]`; model notes + deterministic unresolved messages |
| `risk_areas` | `string[]`, default `[]`; short classifier-authored bullets (≤ 5, ≤ ~12 words each), e.g. `"New dependency: ioredis"`. Distinct from the separate, still-unbuilt `Risks` contract in the same file (`Risk` objects with `severity`/`file_refs`, part of the unbuilt `PrBrief`) — do not conflate the two. |

`IntentSource.kind`: `pr_title` \| `pr_description` \| `linked_issue` \|
`spec_file` \| `external_link` \| `changed_files`.

Classifier structured output (service-local in `intent-service.ts`) is
`{ intent, in_scope, out_of_scope, confidence, missing_context, risk_areas }`
— **no** `sources`.

## `PrIntentRecord`

Source: `contracts/review-api.ts` — `Intent.extend({…})`.

| Field | Type | Role |
|---|---|---|
| `pr_id` | string | PR scope |
| `head_sha` | string \| null | Compared to `pull.head_sha` for stale UI |
| `provider` / `model` | string \| null | Classifier model used |
| `classified_at` | string | Freshness |

## Persistence (`pr_intent`)

Table: `server/src/db/schema/reviews.ts` → `prIntent`. PK `pr_id` →
`pull_requests.id` (cascade delete). Columns mirror the record plus jsonb
`sources` / `missing_context` / `risk_areas` (`risk_areas` added ADD-only by
migration `0015_jazzy_dark_phoenix.sql`, `not null default '[]'`). NUL-scrub
on write in `pull.repo.ts`.

## Prompt / trace

| Slot | Contract | When empty |
|---|---|---|
| `PromptParts.intent` / `PromptAssembly.intent` | Pre-rendered plain text / nullish | Section + `SCOPE_GUIDANCE` omitted |
| `RunTrace.specs_read` | Paths of specs opened **this run** on fresh classify | `[]` on reuse or no intent |

See [ADR 0002](../adr/0002-model-owned-scope-filtering.md) and
[ADR 0003](../adr/0003-specs-read-reuse-for-intent.md).
