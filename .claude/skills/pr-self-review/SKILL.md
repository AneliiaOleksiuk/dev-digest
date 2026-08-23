---
name: pr-self-review
description: "Reviews every local change (committed since main + uncommitted working-tree changes) by routing UI files through the frontend/UI skills and backend files through the backend/domain-architecture skills already in this repo, then reports findings and blocks any GitHub-facing action if a CRITICAL finding exists. Use PROACTIVELY before `gh pr create`, `gh pr edit`, `gh pr merge`, or `git push` of a branch destined for a PR -- and any time the user asks to \"self-review\", \"review my changes\", \"check before PR\", or similar. Run this before `pr-description`."
---

# PR Self-Review

Local, pre-PR review of everything that hasn't landed on `main` yet. It
doesn't invent new rules — it routes the changed files to the domain skills
already catalogued in [../README.md](../README.md) and aggregates their
findings into one pass/block verdict.

## When this runs

- **Proactively**, immediately before running `gh pr create`, `gh pr edit`,
  `gh pr merge`, or `git push` for a branch that is (or will become) a PR.
- **Manually**, any time the user asks for a self-review or a check before
  opening a PR.
- Must be **re-run** if the diff changes after a prior pass — a stale PASS
  does not carry forward to new changes.
- Runs **before** the `pr-description` skill in the PR-opening sequence:
  self-review → (PASS) → draft description → approval → `gh pr create`.

## Step 1 — compute the diff scope

Review *everything not yet on `main`*, committed or not:

```
git fetch origin main            # best-effort; skip silently if it fails (no remote/offline)
git diff main...HEAD --name-only # committed since the branch point
git status --porcelain           # + uncommitted: staged, unstaged, untracked
git diff main...HEAD             # + git diff HEAD  -> the actual hunks to review
```

If there's no merge base with `main` (e.g. reviewing directly on `main`),
fall back to `git diff` / `git status` alone.

Never rule-review files under a package's `Do-not-touch` list
(`*/src/vendor/**`, `*/src/db/migrations/**` per the root
[AGENTS.md](../../../AGENTS.md)) — list them as "generated, not reviewed"
instead of running a skill against them.

## Step 2 — route changed files to existing skills

Only invoke a skill if at least one changed file matches its bucket — don't
run the full catalog on every review.

| Bucket | File patterns | Skills to run |
|---|---|---|
| Frontend/UI | `client/**` (excl. `client/src/vendor/**`), any `*.tsx`/`*.jsx` | [next-best-practices](../next-best-practices/SKILL.md), [react-best-practices](../react-best-practices/SKILL.md), [react-project-structure](../react-project-structure/SKILL.md); [react-testing-library](../react-testing-library/SKILL.md) for `*.test.*`/`*.spec.*` |
| Backend | `server/**` (excl. `server/src/vendor/**`, `server/src/db/migrations/**`) | [fastify-best-practices](../fastify-best-practices/SKILL.md) for routes/plugins; [drizzle-orm-patterns](../drizzle-orm-patterns/SKILL.md) + [postgresql-table-design](../postgresql-table-design/SKILL.md) for `db/schema.ts`/query code |
| Backend domain architecture | `server/src/modules/**`, `server/src/adapters/**` (new modules/adapters only, per that skill's own scope) | [onion-architecture](../onion-architecture/SKILL.md) |
| Reviewer core | `reviewer-core/**` | [typescript-expert](../typescript-expert/SKILL.md), [zod](../zod/SKILL.md) — it's a pure core with no infra, so `onion-architecture` doesn't apply here (see that skill's own note) |
| E2E | `e2e/**` | none of the UI/backend skills (flow JSON + runner, not React) — [typescript-expert](../typescript-expert/SKILL.md) only if `.ts` runner/lib code changed |
| Full-stack, content-based (any bucket) | files defining/using `z.object`/schemas | [zod](../zod/SKILL.md) |
| Full-stack, content-based (any bucket) | any changed `.ts`/`.tsx` | [typescript-expert](../typescript-expert/SKILL.md) |
| Full-stack, content-based (any bucket) | anything touching auth, input handling, secrets, uploads, API routes | [security](../security/SKILL.md) |
| Docs/config/generated | `AGENTS.md`, `INSIGHTS.md`, `README.md`, `package.json`, lockfiles, migrations | not rule-reviewed; list as "skipped (docs/generated)" |

## Step 3 — apply each skill to the diff hunks

Apply each matched skill's rules to the **changed lines**, not the whole
file. Normalize each skill's own severity vocabulary to one 3-tier scale for
this report:

- **CRITICAL** — `security` HIGH-confidence findings; `onion-architecture`
  dependency-rule violations; any skill's own CRITICAL tag (e.g.
  `react-best-practices`, `react-project-structure`); anything that would
  fail typecheck or build.
- **HIGH** — each skill's own HIGH tag.
- **MEDIUM/LOW** — everything else, informational only.

## Step 4 — run the backing automated checks

Reuse the scripts each package already has — don't invent new tooling:

- `pnpm --dir server typecheck` / `pnpm --dir client typecheck` /
  `pnpm --dir reviewer-core typecheck` / `pnpm --dir e2e typecheck` — for
  whichever packages have changed files.
- `pnpm --dir server arch:check` whenever `server/src/modules/**` or
  `server/src/adapters/**` changed — this is the enforcement mechanism
  `onion-architecture` already documents in
  [rules/enforcement.md](../onion-architecture/rules/enforcement.md).

A typecheck failure or `arch:check` failure is always **CRITICAL**.

## Step 5 — report

Group findings by bucket, then by file:

```
severity — file:line — summary — why — suggested fix
```

End with one verdict line:

- `PR self-review: PASSED (N high, M medium/low)` — safe to continue to
  `pr-description` / the GitHub action.
- `PR self-review: BLOCKED — N critical issue(s)` — list them again,
  compactly.

## Step 6 — the gate

This is a **soft, instruction-based gate** — the same shape as
`pr-description`'s approval gate, not a tooling-enforced one:

- **If BLOCKED**: do not run `gh pr create`, `gh pr edit`, `gh pr merge`, or
  `git push` in this turn. Tell the user what's blocking and wait for a fix
  or an explicit, stated override before touching GitHub.
- **If PASSED**: continue normally (e.g. into `pr-description`).
- A BLOCKED → fixed transition requires **re-running this skill** against the
  new diff — don't clear the block by re-reading the old findings.
