# INSIGHTS — server

Accumulated engineering knowledge for this package: what worked, what didn't,
codebase-specific patterns, tool quirks, and open questions — kept OUT of
[CLAUDE.md](CLAUDE.md) under the ≤100-line / map-not-documentation rule.

Read at the start of every session per CLAUDE.md, and updated at the end via
the `engineering-insights` skill — treat entries here as high-confidence
guidance unless CLAUDE.md says otherwise. Append-only; entries must pass the
"cold read" test (actionable without re-investigation) — see
[../.claude/skills/engineering-insights/SKILL.md](../.claude/skills/engineering-insights/SKILL.md).

## What Works

- **Findings severity breakdown (critical/warning/suggestion counts) needed
  zero DB migration.** `server/src/modules/pulls/status.ts` already had a
  tested-but-unused `rollupSeverities(rows: {severity}[])` /
  `SeverityCounts` helper from an earlier, abandoned pass at this feature.
  Reused it as-is (no changes to it or its test
  `server/test/pulls-status.test.ts`) by adding one more `IN`-query against
  `t.findings` in both `modules/pulls/routes.ts` (PR list, keyed by the
  latest review's `reviewId`) and `modules/reviews/repository/run.repo.ts`'s
  `listRunsForPull` (per-run, keyed by `reviews.runId` joined to
  `findings.reviewId`) — mirrors the existing `costByRunId` "one more
  IN-query + JS grouping" pattern already in `pulls/routes.ts`. Unlike
  `findings_count`/`blockers` on `agent_runs`, these counts are **not**
  denormalized at run completion — computed live on every read instead,
  since the query is cheap at this list size and it avoided a schema change.
- **Re-adding per-run `cost_usd` needs zero `reviewer-core`/LLM-adapter
  changes.** `reviewer-core`'s `reviewPullRequest()`
  (`reviewer-core/src/review/run.ts`) and the server's `PriceBook`/
  `estimateCost` (`server/src/platform/price-book.ts`,
  `server/src/adapters/llm/pricing.ts`) already compute a real per-run USD
  cost on every LLM call and return it as `ReviewOutcome.costUsd`. A prior
  commit (`d45ab0d`, "remove per-PR/run cost, keep model pricing") only
  stopped `server/src/modules/reviews/run-executor.ts` from reading
  `outcome.costUsd` and dropped the `agent_runs.cost_usd` column + the
  `cost_usd` field from the `RunStats`/`RunSummary`/`PrMeta` contracts.
  Restoring/using per-run cost anywhere is purely: thread
  `outcome.costUsd` through `run-executor.ts` → `completeAgentRun()` →
  `agent_runs.cost_usd` → contracts — no new cost computation required.

## What Doesn't Work

_(to be filled in)_

## Codebase Patterns

- **PR-list `score` (and now `cost_usd`) is NOT an aggregate across
  reviewer agents.** `server/src/modules/pulls/routes.ts`'s
  `GET /repos/:id/pulls` picks the single most-recently-*created*
  `reviews` row (`kind='review'`) per PR (ordered by `createdAt` desc) and
  reads that one row's `score` (and, via its `runId`, the linked
  `agent_runs.cost_usd`). If several agents (e.g. Security + Performance
  Reviewer) reviewed the same PR, the list shows only whichever agent's
  review was persisted last — not a sum/average across agents. Any future
  per-PR aggregate field on this endpoint should follow this same
  "latest-review's-linked-run" semantics for consistency, unless a
  product decision explicitly asks for a different rollup (e.g. sum across
  all runs). The same "latest-review's-linked-run" semantics were used for
  the new `critical_count`/`warning_count`/`suggestion_count` fields added
  2026-07-30 — they're the severity breakdown of that SAME latest review,
  not summed across every agent/run on the PR.

## Tool & Library Notes

_(to be filled in)_

## Recurring Errors & Fixes

- **`pnpm db:migrate` / `pnpm db:seed` silently do nothing on Windows,
  leaving an empty DB** (symptom: app errors like `relation "users" does
  not exist` or "No default workspace found" even right after running
  them, with zero console output and exit code 0). Root cause: both
  `src/db/migrate.ts` and `src/db/seed.ts` gated their CLI entrypoint on
  `import.meta.url === \`file://${process.argv[1]}\``. On Windows
  `import.meta.url` is `file:///C:/...` (forward slashes) while
  `process.argv[1]` is a native path (`C:\...`), so the concatenated
  string never matches and the whole entrypoint block is skipped — the
  script exits 0 having done nothing. Fixed by comparing
  `fileURLToPath(import.meta.url) === process.argv[1]` instead (both
  sides then in native OS path form). If a similar `tsx`/ESM CLI script
  is added later, use the same comparison, not the raw URL-string one.

## Session Notes

- 2026-07-29: Re-added per-run cost end-to-end (Run Cost Badge feature):
  `agent_runs.cost_usd` column + migration `0010`, threaded `costUsd`
  through `run-executor.ts`/`repository.ts`/`run.repo.ts`, added
  `cost_usd` to `RunStats`/`RunSummary`/`PrMeta` contracts (both vendor
  copies), and extended the pulls-list route to resolve cost via the same
  `reviews.runId` link already used for `score`.
- 2026-07-30: Findings counter (L01) — wired up the previously-dead
  `rollupSeverities`/`SeverityCounts` (no migration; see What Works above),
  added `critical_count`/`warning_count`/`suggestion_count` to `PrMeta` and
  `RunSummary` (both vendor copies), removed the dead client `PrRowView`
  type it was blocking, and extended `reviews.it.test.ts` to assert both
  endpoints return the grounded severity breakdown.

## Open Questions

_(to be filled in)_
