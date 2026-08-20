# Enforcement — dependency-cruiser

Documented rules get ignored under deadline pressure; this repo already has
`dependency-cruiser` as a `server` dependency (used at runtime for the
repo-intel dep-graph feature — `adapters/depgraph/index.ts`), so the same
tool is reused, as a **dev-time architecture check**, instead of adding
ESLint (this repo has no ESLint config anywhere — don't introduce ESLint
from scratch just to get `eslint-plugin-boundaries`; `dependency-cruiser`'s
CLI does the same job with zero new dependencies).

## Config

`server/.dependency-cruiser.cjs` encodes the allowed-imports table from
`dependency-rule.md` as `forbidden` rules, scoped to `src/modules/**` and
`src/adapters/**`. Key rules:

- `no-service-to-db`: `modules/*/service.ts` → `db/schema.ts` / `drizzle-orm`
  / `postgres` is forbidden.
- `no-service-to-adapter-impl`: `modules/*/service.ts` →
  `adapters/**/*.ts` (concrete classes) is forbidden — only importing from
  `@devdigest/shared` (port types) or the module's own `repository.ts` is
  allowed.
- `no-routes-to-db-or-adapter`: `modules/*/routes.ts` → `db/schema.ts` or
  `adapters/**` is forbidden.
- `no-helpers-to-io`: `modules/*/helpers.ts` → `db/**`, `adapters/**`,
  `platform/container.ts` is forbidden.

Cross-module repository access (`dependency-rule.md`'s "Cross-module access"
section) is not yet one of the four rules above — the shipped config only
checks layers *within* a module, not module-to-module edges. It's
mechanizable the same way, using dependency-cruiser's own capture-group
pattern for "a module may only depend on itself, not siblings":

```js
{
  name: 'no-cross-module-repo-access',
  severity: 'error',
  comment:
    "A module depends on another module's service.ts, not its repository — see dependency-rule.md.",
  from: {
    path: '^src/modules/([^/]+)/service\\.ts$',
    pathNot: PRE_EXISTING_MODULES,
  },
  to: {
    path: '^src/modules/([^/]+)/repository(\\.drizzle)?\\.ts$',
    pathNot: '^src/modules/$1/',
  },
},
```

`$1` backreferences the module name captured in `from.path`, so the rule
only fires on a *different* module's repository — a service importing its
own `repository.ts` is still fine. This isn't wired into the real
`server/.dependency-cruiser.cjs` yet: `PRE_EXISTING_MODULES` would need
`conventions`, `brief`, and `onboarding` added first (see the note at the
end of `dependency-rule.md`'s "Cross-module access" section) — same
scope-discipline call as every other rule here, don't skip it to make the
check pass immediately.

Adapter-to-module imports (`dependency-rule.md`'s "Adapter-to-module
imports" section) is a second not-yet-wired rule, running the opposite
direction — an adapter file reaching into `modules/**` instead of a module
reaching into another module:

```js
{
  name: 'no-adapter-to-module',
  severity: 'error',
  comment:
    "adapters/** is infrastructure — it implements a port, it never imports a specific module's file. See dependency-rule.md.",
  from: {
    path: '^src/adapters/',
    pathNot: PRE_EXISTING_ADAPTERS,
  },
  to: {
    path: '^src/modules/',
  },
},
```

No capture group needed here — unlike cross-module repo access, an adapter
importing *any* module (even "its own" conceptually associated one) is the
violation, since an adapter isn't owned by a module the way `service.ts`/
`repository.ts` are. `PRE_EXISTING_ADAPTERS` would need `astgrep` added
before this could ship (see the note at the end of `dependency-rule.md`'s
"Adapter-to-module imports" section) — same scope-discipline call as
`no-cross-module-repo-access` above.

("Only the container wires a port to its concrete adapter" isn't mechanized
— dependency-cruiser rules match single import edges, not "two kinds of
import in the same file." The four rules above already make that violation
rare in practice: if `service.ts`/`routes.ts`/`helpers.ts` can't import
`adapters/**` or `db/schema.ts` at all, there's nowhere left for a stray
adapter wire-up to happen except `container.ts` or `repository.drizzle.ts`.
Treat it as a code-review checklist item, not a lint failure.)

## Running it

```bash
cd server
pnpm arch:check       # runs: depcruise --config .dependency-cruiser.cjs src
```

Add to CI alongside `pnpm typecheck` — same tier as a compile check, not a
slow integration-test-style gate.

## Scope discipline

The config only targets **new-style** paths going forward, not a blanket
`src/**` ban — `modules/reviews/service.ts` importing `ReviewRepository`
directly (a concrete class) is pre-existing and would fail a naive
`no-service-to-concrete-repo` rule. Two options, pick the first unless the
existing violations are being fixed anyway:

1. The shipped config already does this: every current module
   (`agents`, `polling`, `pulls`, `repo-intel`, `repos`, `reviews`, `settings`,
   `workspace`, `_shared`) is listed in each rule's `from.pathNot`, so the
   check currently passes cleanly and only starts applying to a module
   folder the day it's created without being added to that exclusion list, OR
2. If/when `modules/reviews`, `modules/agents` etc. get repository ports
   retrofitted (out of scope for this skill per `SKILL.md`, but a natural
   follow-up), drop the exclusion.

Don't silently widen the exclusion list to "make the check pass" when adding
a new module — the exclusion list should only ever contain modules that
predate this skill.
