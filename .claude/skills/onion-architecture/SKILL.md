---
name: onion-architecture
description: "Forces onion (ports & adapters) architecture on new backend modules: routes → service → port (interface) ← adapter, with domain/application code never importing infrastructure directly. Use PROACTIVELY when adding a new server module (new folder under server/src/modules/), adding a new repository, or adding a new external integration (adapter). Enforced by a dependency-cruiser boundary check, not just documentation. Trigger terms: new module, new repository, new adapter, server/src/modules, port, dependency rule, layered architecture."
metadata:
  tags: architecture, onion, hexagonal, ports-adapters, backend, ddd, fastify, drizzle
---

# Onion Architecture

Forces the dependency rule from Jeffrey Palermo's Onion Architecture (2008) —
"all code can depend on layers more central, but code cannot depend on layers
further out" — onto **new** backend code in `server/`. Existing modules
(`modules/reviews`, `modules/agents`, etc.) predate this skill and are not
retrofitted; use them as reference for the parts they already do right, not
as a template to copy uncritically (see `examples.md` for which parts to
copy and which to skip).

## When to use

- Adding a new folder under `server/src/modules/` (a new feature module).
- Adding a new repository (any class/module that reads or writes `db/schema.ts`).
- Adding a new external integration (LLM provider, GitHub, git, secrets, etc.) —
  i.e. a new adapter behind a port.
- Reviewing a PR that touches `server/src/modules/**` or `server/src/adapters/**`
  and you want to check it doesn't violate the dependency rule.

Not for `client/` (Next.js — see `next-best-practices` / `react-project-structure`)
or `reviewer-core/` (already a pure core with no infra — nothing to enforce,
see `examples.md` for why it's the reference implementation).

## The dependency rule, mapped onto this repo

```
routes.ts  ──▶  service.ts  ──▶  Port (interface)  ◀── implements ── Adapter
(infra-in)      (application)     (application core)      (infra-out)
                                          ▲
                                   Container (composition root)
                                   wires Adapter → Port, injects into Service
```

Concretely, for a module `server/src/modules/<name>/`:

- `routes.ts` — Fastify plugin. Parses/validates with zod (`fastify-type-provider-zod`),
  calls the service, shapes the HTTP response. **No business logic, no DB, no adapter calls.**
- `service.ts` — application layer. Orchestrates use cases. Depends on **port
  interfaces**, never on `drizzle-orm`, `postgres`, `@fastify/*`, or a concrete
  adapter class.
- `repository.ts` (or `ports.ts` + `<name>.drizzle.ts`) — for a **new** module,
  the repository is a port (interface) with a Drizzle implementation behind it
  (see `rules/repository-pattern.md`). Only this file imports `db/schema.ts`.
- `helpers.ts` — pure functions (DTO mapping, formatting). No `this`, no I/O.
- `Container` (`platform/container.ts`) — the only place that constructs a
  concrete adapter/repository and hands it to a service. Services never `new`
  an adapter themselves.

Read `rules/layers.md` for the full layer-to-folder mapping (including
`adapters/`, `platform/`, `db/`) and `rules/dependency-rule.md` for the
precise allowed/forbidden import table.

## How to use this skill

1. **Starting a new module or adapter** → read `rules/module-structure.md`
   and `rules/ports-adapters.md` first, then scaffold files in that order.
2. **Adding a repository** → read `rules/repository-pattern.md` — write the
   interface before the Drizzle class.
3. **Unsure what a service is allowed to import** → `rules/dependency-rule.md`
   has the allowed-imports table; `rules/enforcement.md` explains the
   dependency-cruiser check that catches violations automatically.
4. **Reviewing existing code against this skill** → `examples.md` has
   good/bad pairs pulled from this repo, including what `modules/reviews`
   already gets right (routes/service/repository split, zod at the edge) and
   what it doesn't enforce (repository is a concrete class, not a port) —
   don't "fix" that as a side effect of unrelated work; it's out of scope
   per this skill's own rule (new modules only).
5. **Before opening a PR that adds/touches a module** → run the check
   described in `rules/enforcement.md` (`pnpm arch:check` in `server/`).

## Rules

- [rules/layers.md](rules/layers.md) — the four layers, mapped to `server/src/*`
- [rules/dependency-rule.md](rules/dependency-rule.md) — allowed/forbidden imports per layer
- [rules/ports-adapters.md](rules/ports-adapters.md) — where a port interface lives, how an adapter implements it
- [rules/repository-pattern.md](rules/repository-pattern.md) — repository as a port, Drizzle behind it
- [rules/module-structure.md](rules/module-structure.md) — file-by-file convention for a new `modules/<name>/`
- [rules/enforcement.md](rules/enforcement.md) — the dependency-cruiser config and `pnpm arch:check`

## Other resources

- [examples.md](examples.md) — good/bad pairs from this codebase
- [references.md](references.md) — external sources (original onion architecture article, hexagonal/clean comparisons, Drizzle + repository pattern, enforcement tooling)
