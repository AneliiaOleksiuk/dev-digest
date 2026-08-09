# Ports & adapters

A **port** is an interface owned by the side that *needs* the capability
(application/service layer), not the side that provides it. An **adapter**
is a concrete class implementing that interface, living in `adapters/`.

## Existing pattern to copy (cross-package ports)

`@devdigest/shared` (vendored into `server/src/vendor/shared`) declares
ports consumed by services: `LLMProvider`, `GitHubClient`, `GitClient`,
`SecretsProvider`, `AuthProvider`, `CodeIndex`, `Embedder`. Each has one or
more implementations under `server/src/adapters/<name>/`:

```ts
// port (in @devdigest/shared)
export interface LLMProvider {
  completeStructured<T>(opts: CompleteOpts<T>): Promise<T>;
}

// adapter (server/src/adapters/llm/openai.ts)
export class OpenAIProvider implements LLMProvider { /* ... */ }

// composition root (platform/container.ts)
get llm() { return this.llmCache.get(id) ?? this.buildLLM(id); }
```

Services receive `LLMProvider`, never `OpenAIProvider` — that's what makes
`ContainerOverrides` (test mocks) work without module-mocking.

## New intra-module port (new pattern this skill introduces)

For a **new module**, a repository is also a port — but scoped to the
module, not `@devdigest/shared` (it's not needed outside `server/`):

```ts
// server/src/modules/<name>/repository.ts
export interface <Name>Repository {
  getById(workspaceId: string, id: string): Promise<XRow | undefined>;
  insert(values: XInsert): Promise<XRow>;
}

// server/src/modules/<name>/repository.drizzle.ts
export class Drizzle<Name>Repository implements <Name>Repository {
  constructor(private db: Db) {}
  getById(workspaceId: string, id: string) { /* drizzle query */ }
  insert(values: XInsert) { /* drizzle query */ }
}
```

`service.ts` takes `<Name>Repository` (the interface) in its constructor.
`platform/container.ts` constructs `Drizzle<Name>Repository` and injects it.

## Rule of thumb for naming the port

Name the interface after the **capability**, not the technology:
`ReviewRepository`, not `ReviewDrizzleClient`. The Drizzle-specific name
belongs on the implementation class (`DrizzleReviewRepository`), so a future
swap (different ORM, in-memory fake for tests) doesn't require touching the
interface or any service that depends on it.

## When NOT to introduce a port

Don't wrap something in a port just because this skill exists. Pure,
stateless utilities (date formatting, DTO mapping) stay plain functions in
`helpers.ts` — no interface, no injection. Ports are for things a test would
need to fake or a future change would need to swap (I/O boundaries), not for
every function.
