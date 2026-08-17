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

## repo-intel — import-graph extraction

- **`depgraph.buildEdges` writes zero edges for real, import-heavy repos.**
  Confirmed on `AneliiaOleksiuk/dev-digest`'s own indexed clone (repo id
  `04f27d46-ee19-406a-9e6a-77befcb1f706`): a `full` reindex at commit
  `48bc3af` reports `filesIndexed: 525`, `symbolsWritten: 1550`,
  `referencesWritten: 12912`, and `edgesWritten: 0` in
  `repo_index_state.stats`, with no `graphFailed` key — the graph build ran
  to completion without throwing, it just found no import relationships in
  a 5-package TypeScript monorepo that plainly has thousands. Direct DB
  check confirms `file_edges` has 0 rows for this repo, and `file_rank` has
  525 rows but only 1 distinct percentile (a flat, uninformative ranking —
  `computeFileRank`'s own degenerate-graph fallback, `pipeline/rank.ts:39-47`).
  Downstream effect discovered via SPEC-02: `getCriticalPaths` returns `[]`
  and the Onboarding Generator's own `flatRank` detection (`facts.ts:100`,
  E-4) correctly refuses to present the flat rank as importance order — so
  the feature degraded honestly, but the root cause is upstream. Suspect
  area: `container.depgraph.buildEdges` (adapter, not indexed in this
  session) possibly mishandling this repo's 5-separate-tsconfig,
  no-workspace layout or its `@/` / cross-package import aliases. Needs
  investigation in `repo-intel`/`adapters/depgraph` — starter infrastructure
  no course lesson is meant to modify, so flagged here rather than fixed
  inline.
  — recorded 2026-08-14, found while manually verifying SPEC-02's
  Onboarding Tour page against the live app.

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

## SPEC-03 — PR Brief & Why Timeline (fix-loop iteration 1 bookkeeping)

Flagged by `plan-verifier`'s Phase 3 review as pre-existing failures
unrelated to SPEC-03, confirmed still present after this fix-loop
iteration's changes. None of these files were touched by `be2e056`
(Phase 1 Build), `8bfe36d` (Phase 2 Test), or this fix-loop iteration —
verified via `git log` against each path. Re-confirmed by directly running
each suite in isolation on 2026-08-14:

- **`server/test/indexer-pipeline.test.ts`** — 6/11 failing. Same root
  cause as the SPEC-01 entry above: `writeFileAt`'s directory-boundary
  logic uses `full.lastIndexOf('/')` on a `node:path.join`-produced path,
  which is backslash-joined on win32. Windows-only; not SPEC-03 related.
- **`server/test/onboarding.it.test.ts`** — 8/21 failing in isolation
  (pre-existing fixture gaps, e.g. an expected-empty `sections` array
  assertion at `:541` not matching current fixture output).
- **`server/test/project-context-run.it.test.ts`** — 3/3 passing in
  isolation; the existing SPEC-01 entry above already documents this file's
  AC-22 case as flaky specifically under the parallel integration lane
  (plan-verifier's combined "9 failures" count for these two files reflects
  that parallel-lane flake, not a standalone regression).
- **`client/.../SectionCard.test.tsx > AC-12`** ("the First-tasks badge is
  labelled as a model ESTIMATE...") — 1 failure, pre-existing staleness
  (asserted copy no longer matches the component's current tooltip text).
  1/N in that file; every other `SectionCard.test.tsx` test passes.
  — recorded 2026-08-14, `plan-verifier` Phase 3 report on
  `docs/plans/spec-03-pr-brief-and-why-timeline.md` (fix-loop iteration 1,
  required-fix item 5).
