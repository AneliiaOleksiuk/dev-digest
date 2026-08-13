# Backlog — deferred follow-ups

Concrete, out-of-scope follow-up work discovered while executing an assigned
task. Not an aspirational roadmap — every entry cites the task it was found
during and the file(s) it concerns, so it stays actionable instead of
decaying into vague hopes.

## SPEC-02 — Onboarding Generator

- **Hotness in file ranking (D-1).** The reading path uses flat PageRank only
  — `hotness` is hardcoded `0` in `server/src/modules/repo-intel/pipeline/rank.ts`
  because the clone is shallow (`CLONE_DEPTH = 1`, no churn window) and the
  pipeline reports `hotnessAvailable: false`. Revisiting this means deepening
  the clone and changing the `repo-intel` indexing pipeline — a `repo-intel`
  change, not an Onboarding Generator change, so it's out of scope for
  SPEC-02 itself. Revisit once repo-intel supports it.
  — recorded 2026-08-13, `specs/SPEC-02-onboarding-generator.md` D-1/Q6.

## SPEC-01 — Project Context

Flagged by `plan-verifier`'s Phase 1 as "required fixes," all pre-existing
and unrelated to the AC-29–53 delta (every AC in that delta is MET) —
deferred rather than fixed under that plan's scope.

- **`server/src/adapters/auth/local.ts:40`** — an uncommitted
  `getUserById(db, id)` snippet breaks `server pnpm typecheck` (implicit
  `any` on `db`) and `plan-verifier` flagged its shape as
  SQL-injection-like. Not part of any commit yet — needs its own review
  before landing.
- **`server/test/indexer-pipeline.test.ts:142-144`** — `writeFileAt` finds a
  directory boundary with `full.lastIndexOf('/')`, which breaks under
  `node:path.join`'s backslash-joined paths on win32 (6/11 tests fail on
  Windows). Pre-existing, untouched by SPEC-01.
- **`server/test/project-context-run.it.test.ts`** (the AC-22 case) — flaky
  under the parallel integration lane (passes in isolation). Needs test
  isolation investigation, not a code fix in the delta.
  — recorded 2026-08-13, `plan-verifier` report on
  `docs/plans/spec-01-project-context-authoring.md`.
