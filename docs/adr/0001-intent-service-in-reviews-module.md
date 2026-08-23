# ADR 0001: Keep IntentService inside `modules/reviews`

- **Status:** Accepted
- **Date:** 2026-08-06
- **Context:** Intent Layer (PR intent classification → review scoping)

## Context

Onion-architecture guidance and the dependency-cruiser check prefer a new
backend concern as its own `server/src/modules/<name>/` folder (routes →
service → port ← adapter). Intent classification could have been a new
`modules/intent/` module.

## Decision

Ship `IntentService` and `intent-inputs.ts` inside the existing
`modules/reviews` module. Do **not** create `modules/intent/`.

## Rationale

- The `pr_intent` aggregate, repository functions
  (`upsertIntent` / `getIntent` / `getIntentRecord` in
  `repository/pull.repo.ts`), and the only automated consumer
  (`run-executor.ts`) already live in `modules/reviews`.
- A separate module would either duplicate `ReviewRepository` data access or
  force an import across modules.
- `modules/reviews` is on the dependency-cruiser `PRE_EXISTING_MODULES`
  allowlist, so splitting would not buy enforcement either way; colocating
  avoids duplication regardless.

Documented on the service class itself
(`server/src/modules/reviews/intent-service.ts`).

## Consequences

- Intent HTTP routes stay in `reviews/routes.ts` (`GET`/`POST /pulls/:id/intent`).
- ReviewService exposes `service.intent` for thin route handlers.
- Future extractions "brief" features (Blast Radius, etc.) should re-evaluate
  module boundaries when they gain their own aggregates and consumers — do not
  treat this ADR as a blank cheque to grow `reviews` indefinitely.

## Alternatives considered

1. **New `modules/intent/`** — cleaner folder map, but either duplicates DB
   access or creates a cross-module dependency for one consumer.
2. **Fold classify into `ReviewService` methods** — would mix review
   orchestration with a distinct LLM call path and a second rate-limited
   route surface; rejected in favour of a dedicated service class still
   owned by the reviews module.
