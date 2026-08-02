# server — `@devdigest/api`

Fastify API + Drizzle/Postgres. Imports repos/PRs, indexes with `repo-intel`,
runs the reviewer, stores agents. See [README.md](README.md) for the request/DI
flow diagram and API map.

**Before starting work:** read [INSIGHTS.md](INSIGHTS.md) — treat its
entries as high-confidence guidance unless this file says otherwise.

**Stack:** fastify 5.2, drizzle-orm 0.38, zod 3.24, `postgres` 3.4,
typescript 5.7 (also: `@anthropic-ai/sdk`, `openai`, `octokit`, `simple-git`,
`@ast-grep/napi`, `fastify-type-provider-zod`, `fastify-sse-v2`).

**Commands:** `pnpm dev` (`:3001`) · `build` · `typecheck` · `db:generate` ·
`db:migrate` · `db:seed`. Test split (not in package.json scripts — must be
typed out): unit = `pnpm exec vitest run --exclude '**/*.it.test.ts'`;
integration = `pnpm exec vitest run .it.test`; `pnpm test` runs both.

## Map

- `src/modules/` — one folder per feature (`repos`, `pulls`, `polling`,
  `reviews`, `agents`, `repo-intel`, `settings`, `workspace`), each owns its
  `routes.ts`, registered in `src/modules/index.ts`.
- `src/adapters/` — ports (llm, github, git, astgrep, secrets, tokenizer,
  embedder, codeindex, depgraph) behind the DI container; `mocks.ts` for tests.
- `src/platform/` — config, DI container, error handling, prompts, grounding,
  SSE, resilience, model routing/pricing.
- `src/db/` — Drizzle schema + migrations.
- `src/vendor/shared/` — vendored `@devdigest/shared` Zod contracts.

## Non-default conventions

- DI container (`platform/container.ts`) has **lazy, cached** adapter getters.
  After `SecretsProvider.set()`, you must call `invalidateSecretCaches()` or
  stale LLM/GitHub clients keep using old keys.
- Services depend on adapter **interfaces**, never concrete classes, so tests
  swap in `ContainerOverrides` instead of module-mocking.
- Routes declare zod `params`/`body` schemas; invalid input 422s **before** the
  handler runs — don't hand-roll `Schema.parse(req.body)` in handlers.

## Gotchas

- Secrets are deliberately **excluded** from `AppConfig`/`EnvSchema`. The one
  chokepoint allowed to read them is `LocalSecretsProvider`
  (`src/adapters/secrets/local.ts`).
- `LOG_LEVEL=''` (as shipped in `.env.example`) is coerced to `undefined` via
  `z.preprocess` in `config.ts` — a normal zod enum would reject the empty
  string.
- `EMBEDDINGS_ENABLED=false` (default) makes `Container.embedder()` throw
  **before** constructing an OpenAI client — the intent is literally zero
  OpenAI calls by default; callers must try/catch to degrade gracefully.
- The error handler does a **duck-typed** `ZodError` check (`instanceof` OR
  `.name === 'ZodError'`) because vendored zod and the api's own zod can be
  different module instances.
- `bodyLimit` is hardcoded to 1MB in `app.ts`.
- Rate limiting is fully **disabled** (not just relaxed) under `NODE_ENV=test`.
- `reapStaleRuns()` on boot assumes a **single** API process — no
  multi-replica safety.

## Do-not-touch

- `src/vendor/shared/**` — manual mirror, no sync script; edit upstream, then
  hand-copy.
- `src/db/migrations/**` — drizzle-kit generated; regenerate via
  `pnpm db:generate`, never hand-edit.

## Docs

- [README.md](README.md) — DI/request flow, API map, review-context internals.
- [docs/agent-prompts/README.md](../docs/agent-prompts/README.md) — read before
  touching `modules/reviews` or anything feeding the reviewer prompt.
- [TESTING.md](../TESTING.md) — unit vs integration split details.
- [INSIGHTS.md](INSIGHTS.md) — the "why" behind the decisions above.

**Before ending a session:** update INSIGHTS.md with anything non-obvious
you learned — don't skip this step (`engineering-insights` skill).
