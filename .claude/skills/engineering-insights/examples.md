# Engineering Insights -- Entry Examples

Each pair shows the same discovery written badly (vague, not actionable) and
well (specific, cold-readable). Match the "good" style.

## What Works

- Bad: "Batching helped with the timeout issue."
- Good: "Batching `embedder.embed()` calls at 10 per request avoids the
  30s OpenAI timeout that hit on full-repo indexing (`repo-intel/index.ts`)."

## What Doesn't Work

- Bad: "Promises can be tricky."
- Good: "`Promise.all()` on the ingestion pipeline times out after 30 items
  -- use `Promise.allSettled()` batched at 10 for that module."

- Bad: "Don't use that approach for auth."
- Good: "Storing the refresh token in `localStorage` (tried in
  `client/src/lib/hooks/useAuth.ts`) broke on Safari ITP after 7 days --
  switched to an httpOnly cookie set by the API."

## Codebase Patterns

- Bad: "The DI container is a bit unusual."
- Good: "`platform/container.ts` adapter getters are lazy and cached --
  after `SecretsProvider.set()` you must call `invalidateSecretCaches()` or
  stale LLM/GitHub clients keep using the old key."

## Tool & Library Notes

- Bad: "Zod coercion is confusing."
- Good: "`z.preprocess` in `config.ts` is required because `LOG_LEVEL=''`
  (as shipped in `.env.example`) needs to coerce to `undefined` -- a plain
  `z.enum` rejects the empty string outright."

## Recurring Errors & Fixes

- Bad: "Tests sometimes fail with a DB error."
- Good: "Integration tests intermittently fail with `ECONNREFUSED` on
  Postgres if `docker compose up` hasn't finished healthcheck yet -- run
  `pnpm db:wait` (or just retry) before `pnpm test:it`, don't assume the
  container is ready right after `up -d` returns."

## Session Notes

- Bad: "Worked on the reviews module."
- Good: "2026-07-29: Traced the SSE reconnect bug in
  `modules/reviews/routes.ts` to a missing `Last-Event-ID` header on retry;
  fixed, added a regression test."

## Open Questions

- Bad: "Not sure about the npm/pnpm thing."
- Good: "`reviewer-core` is the only package on npm instead of pnpm --
  unclear if intentional (isolation from the rest?) or bootstrapping
  artifact. Worth asking before normalizing it."
