# Discovery — packages, package managers, internal edges

## Find every package

```
Glob: */package.json
```

At the time this skill was written that resolves to `client`, `server`,
`reviewer-core`, `mcp`, `e2e`, `evals` — but don't hardcode that list. New
packages get added (`evals/` itself was added after AGENTS.md's package
table was last edited), so re-glob every run.

For each hit, read `name`, `dependencies`, `devDependencies`,
`peerDependencies`, `optionalDependencies` from that `package.json`.

## Detect the package manager per package — don't trust AGENTS.md's claim

AGENTS.md states: *"reviewer-core/ is the only package on npm
(package-lock.json); every other package is pnpm."* Check this yourself
instead of repeating it — it's already gone stale once. Detect directly:

- `pnpm-lock.yaml` present → pnpm
- `package-lock.json` present → npm
- neither → flag it in the report as "no lockfile committed," don't guess

Whatever you find that contradicts AGENTS.md's text, put in the report's
**Drift & risk flags** section (see `report-format.md`) — that mismatch is
exactly the kind of thing this skill exists to surface, and it's not this
skill's job to silently fix AGENTS.md as a side effect.

## Map the internal (repo-to-repo) dependency graph

This repo has no workspace tool, so there is no single manifest that lists
"package A depends on local package B." There are two distinct mechanisms —
report them as two distinct kinds of edges, don't collapse them:

**1. Live imports via tsconfig path aliases** — grep each package's
`tsconfig*.json` for a `"paths"` block:

```
Grep: "paths" in <package>/tsconfig*.json, then read the block
```

Each alias whose target points outside the package's own `src/` (e.g.
`"@devdigest/reviewer-core": ["../reviewer-core/src/index.ts"]`) is a real,
live, compiler-enforced edge — code changes on one side show up on the
other side immediately, no copy step. Draw these as solid arrows in the
mermaid diagram.

**2. Hand-mirrored copies under `src/vendor/`** — per AGENTS.md, some
"shared" code is *copied*, not imported: `@devdigest/shared` and
`@devdigest/ui` live under `<package>/src/vendor/**` in more than one
package, with **no sync script**. These are not compiler-enforced edges —
two copies can silently drift apart. Detect them by checking whether a
tsconfig path alias resolves to a path containing `/vendor/` inside the
package's own tree (as opposed to `../other-package/src/...`), and draw
these as dashed arrows labeled "manually mirrored — can drift," not as
solid dependency arrows. This distinction is the single most important
thing this diagram needs to get right — treating a stale copy as if it
were a live import gives a developer false confidence that fixing one side
fixed both.

Cross-check: `grep -r "src/vendor" */tsconfig.json` gives you every mirrored
alias in one pass across all packages.
