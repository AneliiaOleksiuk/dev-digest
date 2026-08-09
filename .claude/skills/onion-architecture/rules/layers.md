# Layers

Four concentric layers, center to edge. Dependencies only point inward
(center has zero knowledge of anything outer).

## 1. Domain (center)

Plain types and pure business rules with **zero** dependencies on Node, HTTP,
or a database. In this repo this mostly lives as:

- Zod-inferred types from `@devdigest/shared` (`server/src/vendor/shared`) —
  `Finding`, `RunTrace`, `RunEvent`, etc. These are the entities.
- `reviewer-core/` in its entirety: diff → prompt → LLM → grounded findings,
  with the LLM itself injected as a port (`LLMProvider`). No DB, no
  filesystem, no GitHub. This is the cleanest example of a domain+application
  core in the repo — read it before writing a new one.

If a new module has real business rules beyond CRUD (validation, scoring,
state transitions), pull them into pure functions in a `helpers.ts` or
`domain.ts` that takes/returns plain data — no `this`, no I/O, no imports
from `adapters/` or `db/`.

## 2. Application

Use-case orchestration. In this repo: `modules/<name>/service.ts`.

- Depends on **port interfaces**, injected via the constructor (or taken
  from `Container`) — never a concrete adapter/repository class.
- Coordinates calls across ports, applies domain rules, returns DTOs.
- May depend on other application services (e.g. `ReviewService` uses
  `Container['agentsRepo']`) but that's still a port reference, not the
  concrete `AgentsRepository` class — for **new** repositories, expose the
  interface type here, not the class (see `repository-pattern.md`).

## 3. Ports (interfaces — still application-facing, defined near the core)

Interfaces owned by the application layer, implemented by infrastructure.
Already-established pattern in this repo, in `@devdigest/shared`:
`GitHubClient`, `GitClient`, `LLMProvider`, `SecretsProvider`, `AuthProvider`,
`CodeIndex`, `Embedder`. A new repository interface for a new module follows
the same shape, but lives next to the module (`modules/<name>/repository.ts`
exporting the interface), not in `shared` — `shared` is for ports crossing
package boundaries (server ↔ reviewer-core), not intra-server ports.

## 4. Infrastructure / Adapters (outer edge)

Everything that talks to the outside world:

- `server/src/adapters/*` — concrete implementations of the ports above
  (`adapters/llm/openai.ts` implements `LLMProvider`, `adapters/github/octokit.ts`
  implements `GitHubClient`, etc.).
- `server/src/db/*` — Drizzle schema, migrations, the `Db` client type.
  A new repository's Drizzle implementation lives here or colocated in the
  module (see `repository-pattern.md`) — either way it's the *only* code
  that imports `db/schema.ts` for that aggregate.
- `server/src/modules/<name>/routes.ts` — the HTTP adapter. Fastify-specific,
  zod validation at the boundary, translates HTTP ↔ service calls.
- `platform/container.ts` — the composition root. The only place allowed to
  `new` a concrete adapter/repository class and wire it to a port.

## What doesn't map cleanly (and that's fine)

`platform/` also holds cross-cutting infrastructure that isn't a classic
"adapter" (config, error types, SSE bus, job runner, model routing/pricing).
Treat `platform/` as infrastructure for dependency-rule purposes (application
code may depend on `platform/errors.ts` types like `AppError`/`NotFoundError`
since those are effectively part of the port contract, but not on
`platform/container.ts` itself — a service takes what it needs via
constructor injection, it doesn't reach into the container).
