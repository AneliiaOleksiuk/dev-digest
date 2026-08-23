# New module structure — file order

Scaffold in this order; each file should only need what came before it.

1. **`repository.ts`** — the port interface + row/DTO types it returns.
   No Drizzle imports here.
2. **`repository.drizzle.ts`** — the Drizzle implementation of the interface.
   The only file in the module allowed to import `db/schema.ts`.
3. **`helpers.ts`** — pure functions: DTO mapping (row → API shape),
   formatting, pure calculations. No `this`, no I/O, no port imports.
4. **`service.ts`** — the application service. Constructor takes the
   repository *interface* (and any other ports it needs — e.g. `LLMProvider`).
   Contains the use-case methods routes will call.
5. **`routes.ts`** — Fastify plugin. Reads `app.container`, constructs the
   service with the concrete repo from the container
   (`new <Name>Service(container.xRepo)` or equivalent), declares zod
   `params`/`body`/`querystring` schemas per route, calls service methods,
   shapes the response. No business logic.
6. Register the module in `modules/index.ts` (existing convention).
7. **`platform/container.ts`** — add the lazy getter for the new repository
   (and adapter, if the module introduces one), following the existing
   `_reviewRepo` / `get reviewRepo()` pattern.

## What NOT to add

- No `domain.ts` file if the module has no business rules beyond CRUD +
  DTO shaping — `helpers.ts` is enough. Don't create empty ceremony layers.
- No per-module DI container or service-locator — `platform/container.ts`
  is the single composition root for the whole app; a module never builds
  its own.
- No repository method that isn't called by at least one service method —
  don't pre-build a "full CRUD" interface speculatively (matches
  `AGENTS.md`: "Don't add features... beyond what the task requires").

## Reference

`modules/reviews/` already has the routes → service → repository split and
zod-at-the-edge validation right — read it for those two things. It does
**not** have the repository-as-port split — see `repository-pattern.md` for
what to do differently in a new module.
