---
name: dependency-checker
description: "Audits every package in this repo's dependency graph: what each package (client, server, reviewer-core, mcp, e2e, evals) depends on, how heavy each dependency is on disk, which versions are outdated, and which have known security advisories — then draws the real cross-package dependency diagram and ends with a prioritized, actionable punch list. Use PROACTIVELY whenever the user asks about dependency size, bundle weight, node_modules bloat, outdated packages, a dependency audit, a dependency diagram/graph, \"what depends on what\" across packages, or wants to understand or clean up this repo's dependency footprint — even if they don't use the word \"skill\" or name a specific package. Also use when reviewing whether it's safe to add a new dependency, since the report shows what's already heavy or duplicated."
metadata:
  tags: dependencies, audit, package-size, node_modules, outdated, security-audit, dependency-graph, mermaid
---

# Dependency Checker

Answers "what is our dependency footprint, and what should we do about it"
for this repo. This is **not a monorepo** — `client/`, `server/`,
`reviewer-core/`, `mcp/`, `e2e/`, `evals/` each have their own
`package.json` and lockfile, mixing pnpm and npm — so there is no single
`pnpm list --recursive` or lockfile that already has this answer. This
skill assembles it from each package's own state.

## When to use

- "How big is our node_modules", "what's the heaviest dependency", "is our
  bundle bloated"
- "Are we using outdated packages", "run a dependency audit"
- "Draw/show the dependency graph between our packages"
- Before adding a new dependency, to check whether something similar
  already exists or is already heavy elsewhere in the repo
- Periodic hygiene check — no specific trigger needed beyond the user
  wanting a state-of-dependencies picture

Not for auditing a single third-party library's own internals, and not a
replacement for this repo's `security` skill on a real vulnerability
finding — see `rules/outdated-and-audit.md` for where the line is.

## Why a plain `npm ls` isn't enough here

Three things make this repo's dependency picture easy to get wrong if you
don't check the actual filesystem state:

1. **Package manager is mixed and drifts.** AGENTS.md claims only
   `reviewer-core` is on npm — as of writing, `mcp` and `e2e` are also npm
   (only `pnpm-lock.yaml` vs `package-lock.json` on disk tells you the
   truth). Detect it per package, every run — `rules/discovery.md`.
2. **"Depends on" means two different things here.** Some cross-package
   code sharing is a live, compiler-enforced tsconfig path alias (e.g.
   `mcp` → `../reviewer-core/src`); some is a **hand-mirrored copy** with no
   sync script (`@devdigest/shared`, `@devdigest/ui` under `src/vendor/**`
   in more than one package). Drawing both as the same kind of arrow hides
   the fact that one of them can silently go stale. `rules/discovery.md`.
3. **Installed size on disk isn't one number.** pnpm's content-addressable
   store and npm's flat copies attribute size very differently; naively
   summing `du` over `node_modules/*` either double- or under-counts
   depending on the manager. `rules/sizing.md` explains the two numbers the
   bundled script reports and why both are needed.

## Workflow

1. **Discover packages and their manager.** Glob `*/package.json`, detect
   pnpm vs npm per package from its lockfile. Don't trust AGENTS.md's text
   for this — verify. → `rules/discovery.md`
2. **Map the internal dependency graph.** Grep each `tsconfig*.json` for
   `"paths"`; classify each alias as a live import or a mirrored-copy edge.
   → `rules/discovery.md`
3. **Measure installed size per package.** Run
   `node .claude/skills/dependency-checker/scripts/measure-sizes.mjs <package-dir>`
   for each package. If `node_modules` is missing, say so and ask before
   installing — don't estimate from the lockfile instead, that defeats the
   point of measuring real size. → `rules/sizing.md`
4. **Check outdated versions and run a basic audit.** `pnpm outdated` /
   `npm outdated` and `pnpm audit` / `npm audit`, per package, with
   `--json`. Remember both exit non-zero on a normal "found something"
   result — don't treat that as a tool failure. Also flag any dependency
   pinned to different version ranges across packages. →
   `rules/outdated-and-audit.md`
5. **Compose the report.** Fixed section order, diagram before the size
   ranking, recommendations last and impact-ordered. Write it to chat and
   to `docs/reports/dependency-report-<date>.md`. →
   `rules/report-format.md`

Steps 1-2 and steps 3-4 are independent of each other — do them in
parallel rather than strictly in sequence when the tooling allows it.

## Rules

- [rules/discovery.md](rules/discovery.md) — finding packages, detecting
  pnpm vs npm per package, mapping live-import vs mirrored-copy edges
- [rules/sizing.md](rules/sizing.md) — using `scripts/measure-sizes.mjs`,
  what its two size numbers mean, handling a missing `node_modules`
- [rules/outdated-and-audit.md](rules/outdated-and-audit.md) — exact
  commands per package manager, exit-code gotchas, cross-package version
  consistency
- [rules/report-format.md](rules/report-format.md) — the exact report
  template and section order

## Resources

- [scripts/measure-sizes.mjs](scripts/measure-sizes.mjs) — read-only,
  zero-dependency Node script; the only piece of this skill that touches
  the filesystem beyond reading `package.json`/`tsconfig.json` files
