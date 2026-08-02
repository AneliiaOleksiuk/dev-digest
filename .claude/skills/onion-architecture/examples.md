# Examples

Pulled from the actual codebase — good parts to copy, bad parts to avoid
copying into new modules.

## Good: `reviewer-core` as a pure application core

`reviewer-core/src/review/run.ts` orchestrates diff → prompt → LLM →
grounded findings using only an injected `LLMProvider` port. No `db`, no
`fs`, no `fastify`. This is what "domain/application layer with zero
infrastructure knowledge" looks like in this codebase — it's a whole
*package* that is the center of the onion, consumed by `server/` through a
tsconfig path alias. New module business logic that's non-trivial should
aspire to this shape (pure functions over injected ports), even if it
doesn't need its own package.

## Good: zod validation at the HTTP boundary

`server/src/modules/reviews/routes.ts`:

```ts
app.post(
  '/pulls/:id/review',
  { schema: { params: IdParams } },
  async (req) => {
    const body = RunRequest.parse(req.body ?? {});
    // ...
  },
);
```

Validation happens in the adapter (`routes.ts`), the service receives
already-validated, typed data. Keep this — it's exactly where a boundary
adapter's responsibility should stop.

## Good: ports for cross-cutting external systems

`platform/container.ts` never lets a service construct
`OpenAIProvider`/`OctokitGitHubClient` directly — services take
`LLMProvider`/`GitHubClient` (interfaces from `@devdigest/shared`), and only
the container constructs concrete classes. `ContainerOverrides` swaps in
fakes for tests without `vi.mock()`. Copy this shape for any new external
integration.

## Bad (don't replicate in a new module): repository is a concrete class, not a port

`server/src/modules/reviews/repository.ts`:

```ts
export class ReviewRepository {
  constructor(private db: Db) {}
  // ...
}
```

`server/src/modules/reviews/service.ts`:

```ts
export class ReviewService {
  private repo: ReviewRepository;
  constructor(private container: Container) {
    this.repo = new ReviewRepository(container.db); // service constructs its own adapter
  }
}
```

Two violations of the dependency rule at once: `service.ts` imports the
*concrete* `ReviewRepository` (should depend on an interface), and it
constructs it itself from `container.db` (should receive the finished
repository from the container — the composition root's job).

This is pre-existing and **out of scope** for this skill to fix retroactively
(see `SKILL.md`). For a **new** module, write the interface first — see
`rules/repository-pattern.md` for the corrected shape:

```ts
// repository.ts (port)
export interface XRepository { getById(...): Promise<XRow | undefined>; }

// repository.drizzle.ts (adapter)
export class DrizzleXRepository implements XRepository { /* ... */ }

// service.ts (application) — takes the interface, doesn't construct it
export class XService {
  constructor(private repo: XRepository) {}
}

// container.ts (composition root) — the only place that constructs it
get xRepo(): XRepository { return (this._xRepo ??= new DrizzleXRepository(this.db)); }
```

## Bad: mixing DTO mapping with query calls

Keep `helpers.ts`-style pure functions (`findingRowToDto`, `reviewToDto` in
`modules/reviews/helpers.ts`) free of repository/adapter calls — they take
rows, return DTOs, nothing else. If a new module's mapping needs to *fetch*
something (e.g. resolve a related entity), that orchestration belongs in
`service.ts`, not in the pure helper.
