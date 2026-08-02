# Dependency rule — allowed imports table

Applies to **new** code under `server/src/modules/<name>/` and
`server/src/adapters/<name>/`. Rows are the file doing the importing;
columns say whether importing that target is allowed.

| From \ To                          | `db/schema.ts`, `drizzle-orm`, `postgres` | Concrete adapter class (e.g. `adapters/llm/openai.ts`) | Port interface (`@devdigest/shared`, or module's own `repository.ts` interface) | `platform/container.ts` (the `Container` class) | `fastify`, `@fastify/*` |
|---|---|---|---|---|---|
| `routes.ts` | ❌ | ❌ | ✅ (via service) | ✅ (reads `app.container`, constructs the service) | ✅ |
| `service.ts` | ❌ | ❌ | ✅ | ❌ | ❌ |
| `helpers.ts` / `domain.ts` (pure) | ❌ | ❌ | ❌ (takes plain data, not ports) | ❌ | ❌ |
| `repository.ts` (Drizzle impl) | ✅ | — | ✅ (implements the interface) | ❌ | ❌ |
| `adapters/<x>/<impl>.ts` | only if that adapter *is* the DB adapter | — | ✅ (implements the interface) | ❌ | ❌ |
| `platform/container.ts` | ✅ (constructs repos) | ✅ (constructs adapters) | ✅ | — | ❌ |

Key consequences:

- **`service.ts` never imports `drizzle-orm`, `postgres`, or `db/schema.ts`.**
  If a service needs data, it calls a method on an injected repository
  *interface*. This is the rule most likely to be violated by copy-pasting
  from `modules/reviews/service.ts`, which (pre-dates this skill) imports the
  concrete `ReviewRepository` class — don't copy that part for a new module.
- **`routes.ts` never imports an adapter or `db/schema.ts` directly.** All
  DB/adapter access goes through the service.
- **Only `platform/container.ts` imports both a port interface and its
  concrete adapter/repository implementation** — that's the composition
  root's job, nowhere else.
- **Pure helpers (`helpers.ts`) take and return plain data**, not ports —
  if a function needs to call an adapter, it belongs in `service.ts`, not
  `helpers.ts`.

This table is also encoded as an executable check — see `enforcement.md`.
It is deliberately narrower than "wire everything through DI frameworks";
this repo uses plain constructor injection via `Container`, not a DI
container library — keep it that way (see `AGENTS.md` cross-cutting
conventions: "not a monorepo", minimal tooling).
