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

## Cross-module access

The table above governs layers *inside* one module. A separate rule governs
module *boundaries*: a module never imports another module's `repository.ts`
or `repository.drizzle.ts` directly, even for a read. That's the same
violation as `routes.ts` skipping `service.ts` to query `db/schema.ts`
itself — just one hop further out. If module A needs data module B owns,
A's `service.ts` depends on B's **`service.ts`** (obtained via `Container`),
not B's repository or port.

```
modules/analytics/service.ts ──▶ modules/reviews/service.ts   ✅ (through the owning module's service)
modules/analytics/service.ts ──▶ modules/reviews/repository.ts ❌ (reaches around it)
```

This keeps each module free to reshape its own persistence (rename a table,
split a repository into per-aggregate files per `repository-pattern.md`)
without an unrelated module's code or tests breaking — the same reason
`service.ts` doesn't import `db/schema.ts` directly, applied one layer out.

Exception: shared, cross-package ports (`@devdigest/shared` —
`LLMProvider`, `GitHubClient`, etc.) aren't owned by any one module, so
depending on one isn't a cross-module violation.

Note: several pre-existing modules already reach into another module's
repository this way (`conventions/service.ts` → `repos/repository.ts`,
`brief/repository.drizzle.ts` → `reviews/repository.ts`,
`onboarding/service.ts` → `repos/repository.ts`) — same "pre-dates this
skill, don't copy it into new code" status as the repository-as-concrete-class
pattern in `modules/reviews`. Don't use them as precedent for a new module.

## Adapter-to-module imports

A different-shaped violation, running the other direction: an **adapter**
importing from a **module**. `adapters/<name>/` is infrastructure — the
outermost layer, per `layers.md`. It exists to implement a port so any
module can use it interchangeably; the moment an adapter reaches into
`modules/<name>/` to reuse a helper, a type, or a constant, it stops being
generic infrastructure and becomes secretly coupled to that one module —
the dependency arrow now points the wrong way (outer knowing about a
specific inner consumer), and the adapter can no longer be swapped, tested
in isolation, or reused by a second module without dragging the first
module in as a transitive dependency.

```
adapters/email/sendgrid.ts ──▶ modules/digest/helpers.ts    ❌ (infra reaching into a module)
modules/digest/service.ts  ──▶ adapters/email/sendgrid.ts    ❌ (already forbidden above — the port, not the class)
```

If an adapter needs data shaped a particular way, that shaping is the
*service's* job, done before calling the port method — the adapter receives
already-formatted plain data as a parameter, the same way `helpers.ts`
receives plain data rather than reaching for a port (see the "Key
consequences" bullet on pure helpers, above). An adapter's only inbound
dependency is the port interface it implements (from `@devdigest/shared`,
or the module's own `repository.ts`/`ports.ts`) and generic infra types —
never a specific module's file.

Note: `adapters/astgrep/index.ts` already imports `MAX_SIGNATURE_CHARS` and
`SUPPORTED_EXT` from `modules/repo-intel/constants.ts` — same "pre-dates
this skill" status as the other exceptions on this page. Don't copy it into
a new adapter.
