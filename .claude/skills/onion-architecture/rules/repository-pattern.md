# Repository pattern for new modules

For a **new** module's repository, always write the interface first, then
the Drizzle implementation. This is the one place `modules/reviews` and
`modules/agents` don't follow this skill (they export a concrete class
directly) — don't copy that shape into new code; it's tracked as pre-existing
debt, not the pattern to replicate (see `SKILL.md` scope note).

## Shape

```ts
// modules/<name>/repository.ts — the port
import type { Db } from '../../db/client.js';
import type { XRow, XInsert } from '../../db/rows.js';

export interface <Name>Repository {
  getById(workspaceId: string, id: string): Promise<XRow | undefined>;
  listForWorkspace(workspaceId: string): Promise<XRow[]>;
  insert(values: XInsert): Promise<XRow>;
}

// modules/<name>/repository.drizzle.ts — the adapter
import { eq, and } from 'drizzle-orm';
import * as t from '../../db/schema.js';
import type { <Name>Repository } from './repository.js';
import type { Db } from '../../db/client.js';

export class Drizzle<Name>Repository implements <Name>Repository {
  constructor(private db: Db) {}

  getById(workspaceId: string, id: string) {
    return this.db.query.x.findFirst({
      where: and(eq(t.x.workspaceId, workspaceId), eq(t.x.id, id)),
    });
  }
  // ...
}
```

`service.ts`:

```ts
export class <Name>Service {
  constructor(private repo: <Name>Repository) {}
}
```

`platform/container.ts` (composition root):

```ts
private _xRepo?: <Name>Repository;
get xRepo(): <Name>Repository {
  return (this._xRepo ??= new Drizzle<Name>Repository(this.db));
}
```

## Why this matters here specifically

- **Testability**: `ContainerOverrides` already exists for adapters
  (`llm`, `github`, `git`, ...) precisely so tests swap in fakes instead of
  mocking modules (see `server/AGENTS.md`: "Services depend on adapter
  interfaces, never concrete classes, so tests swap in `ContainerOverrides`
  instead of module-mocking"). A new repository that skips the interface
  can't be swapped the same way — it forces `vi.mock()` module-mocking for
  that one module, breaking the existing test convention.
- **Workspace scoping**: keep `workspaceId` as an explicit parameter on every
  port method (as `ReviewRepository` already does) — it's the enforcement
  mechanism for tenant isolation, not just a query filter. Don't let a
  Drizzle implementation infer it from context.

## Multi-aggregate repositories

If a module's repository grows to cover several aggregates (as
`ReviewRepository` does — reviews, findings, runs, pulls), split the Drizzle
implementation into per-aggregate files under `repository/` and have the
class compose them (exactly as `modules/reviews/repository/*.repo.ts` already
does) — but the **public type new services depend on is still one interface**,
not the individual `*.repo.ts` modules.
