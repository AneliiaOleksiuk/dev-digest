# ADR 0011: One shared, SQL-side aggregation for both the Stats tab and the Agent Performance dashboard

- **Status:** Accepted
- **Date:** 2026-08-28
- **Context:** SPEC-06 Agent Performance dashboard + per-agent Stats tab —
  how to compute the workspace-wide dashboard and the per-agent Stats tab so
  the two are *reconciled by construction*, not by a test that happens to
  pass today

## Context

`README.md` splits this work across two lessons — L07 "per-agent stats", L08
"Agent performance dashboard" — which is exactly how two independent
aggregation formulas get written for the same underlying question: is this
agent worth what it costs? A dashboard whose numbers don't reconcile against
the per-agent screen it links to (via the table's "View" action) is worse
than no dashboard, because it looks authoritative while quietly disagreeing
with itself.

The spec's central acceptance criterion, AC-18, makes this concrete: for any
agent and any range, the dashboard's `runs`, `avg_cost_usd`, `avg_latency_ms`
and `accept_rate` for that agent must equal that agent's Stats tab values for
the same range, **exactly**. The only design that makes AC-18 a structural
guarantee rather than a coincidence is one where both surfaces call the same
code, parameterized only by how many agents they ask for.

## Decision

**Both `GET /agents/:id/stats` and `GET /agents/performance` compute every
number from one function, `perfStatsForAgents(workspaceId, agentIds[],
range)`** (`server/src/modules/reviews/repository/run.repo.ts`), called with
a single agent id by the Stats-tab route and with the workspace's full agent
list by the dashboard route. Its result feeds one pair of pure shaping
functions, `toAgentStats`/`toAgentPerf` (`server/src/modules/agents/performance.ts`),
which project the same per-agent aggregate into `AgentStats` and `AgentPerf`
respectively — no second accept-rate or cost formula exists anywhere in
either file.

`perfStatsForAgents` defines the **counted run set** exactly once —
`agent_runs` rows where `workspace_id` matches, `ran_at` falls in the
half-open `[range.start, range.end)`, `status = 'done'`, and `agent_id IS
NOT NULL` — and computes every number over that set **in SQL**, as three
`GROUP BY` queries, independent of `agentIds.length`:

1. `agent_runs` `GROUP BY (agent_id, model)` — run counts, cost sums
   (null-cost tracked separately so a NULL is never coerced to `0`),
   per-model cost split, avg duration, `last_run_at`.
2. `agent_runs` `GROUP BY (agent_id, width_bucket(ran_at))` — the
   findings-per-run trend, sliced into equal-width buckets by Postgres's own
   `width_bucket()`.
3. `findings ⋈ reviews`, inner-joined to `agent_runs` on the same
   counted-run filter, `GROUP BY (reviews.agent_id, findings.severity)` with
   `FILTER (WHERE …)` conditional accepted/dismissed counts.

This SQL-side shape was not the first cut. The implementation originally
materialized the counted run set into Node and summed it there — three
sums-and-a-loop over an array of raw rows. `plan-verifier`'s Phase 1 review
flagged this as a **Major** finding against NFR-3 ("aggregation happens in
SQL via `GROUP BY`, never by loading findings into Node"), and it was
rewritten to the three-query shape above in the first fix-loop iteration.

## Rationale

- **Reconciliation by construction, not by a passing test.** AC-18's
  integration test exists and passes, but the reason it *must* pass is that
  both routes are two thin wrappers around the same function call — there is
  no formula to diverge. A design with two independently-written aggregation
  paths could pass AC-18 today and silently drift the next time either path
  is touched; this design cannot drift without an editor deliberately
  duplicating the query.
- **One counted-run-set definition, reused for cost, duration, findings,
  and trend.** AC-8 requires this explicitly: tiles, table rows, and both
  cost donuts on the dashboard must all sum from the same fixture run set as
  the Stats tab. Defining the filter once, as one `and(...)` expression
  (`countedFilter` in `perfStatsForAgents`) reused across all three queries,
  is what makes that true rather than aspirational.
- **SQL-side aggregation is a security/cost requirement, not just
  cleanliness (NFR-3, A06).** A custom range can span up to 366 days across
  every workspace agent. Loading that row set into Node to sum it is a
  request whose cost scales with row count in application memory and CPU,
  not just query time — a cheap request that is expensive to serve, the
  exact DoS shape NFR-3 exists to close off. Three bounded `GROUP BY`
  queries keep the aggregation cost inside Postgres regardless of range size.
- **No per-agent round trips (NFR-4).** `AgentsService.stats()` (the
  pre-existing `GET /agents/stats` estimate endpoint) was already fixed once
  from an N+1 — one `avg()` round trip per agent — to a single batched query.
  `perfStatsForAgents` follows the same discipline: three queries total,
  regardless of whether it's called for one agent or the whole workspace.

## Consequences

- **A per-agent number cannot silently diverge between the dashboard and the
  Stats tab** as long as both keep calling `perfStatsForAgents` + the shared
  shaping functions. A future change that adds a third, bespoke query for
  either surface — instead of extending the shared function — reintroduces
  exactly the two-formula risk this ADR closes off, and should be treated as
  a regression against this decision, not a reasonable shortcut.
- **`modules/agents/performance.ts` depends on the reviews module's internal
  row shapes** (`PerfRunAggRow`/`PerfTrendRow`/`PerfFindingAggRow`), imported
  through the `ReviewRepository` facade (`modules/reviews/repository.ts`)
  rather than a dedicated port type — the same sanctioned cross-cutting route
  `AgentsService.stats()` already uses via `container.reviewRepo`.
  `plan-verifier`'s Phase 2 review flagged this as a Minor: it satisfies the
  onion-architecture boundary (no raw `db`/schema import from the agents
  module), but it couples the agents module's shaping logic to the reviews
  module's internal `GROUP BY` projection shape rather than to a type
  designed as a stable contract between the two modules. Accepted for this
  feature; worth a dedicated port type if a third consumer of these rows
  appears.
- **Two runtime bugs were only found by exercising the query against a real
  database, not by typecheck or the unit suite.** Reusing the same raw
  `sql` fragment object in both a `SELECT` list and `GROUP BY` produces a
  misleading Postgres error (`42803`, complaining about an unrelated column)
  instead of a clear one about the fragment itself — fixed by computing the
  bucket expression in a derived subquery first, then grouping by the
  subquery's own column. Separately, a raw `sql<Date>` aggregate
  (`max(ran_at)`) type-checks as a `Date` but returns a plain string at
  runtime, because Drizzle's column-type decoding only applies to
  schema-declared columns selected directly, not to raw `sql` fragments —
  fixed with an explicit `new Date(...)` at the mapping boundary. Both are
  now documented in `server/INSIGHTS.md` as a general lesson about `sql<T>()`
  being compile-time-only.
- **The shared function's shape is now load-bearing for both endpoints at
  once.** A future change to `perfStatsForAgents`'s counted-run-set
  definition (e.g. adding a `source` filter) changes both surfaces
  simultaneously — which is the point, but it also means there is no way to
  evolve one surface's numbers independently of the other without forking
  the function, which would reopen the exact problem this ADR closes.

## Alternatives considered

1. **Two independent aggregation implementations, one per endpoint, kept in
   sync by the AC-18 integration test alone.** Rejected — this is precisely
   the failure mode the spec's Problem section names explicitly (two
   lessons, two independently-plausible formulas). A passing test today says
   nothing about whether the next person editing either formula in isolation
   keeps them equal.
2. **Load the counted run set into Node and aggregate it there (the first
   cut).** Rejected after `plan-verifier`'s Phase 1 review — violates NFR-3's
   SQL-aggregation requirement and scales the request's memory/CPU cost with
   row count instead of bounding it in Postgres. Superseded by the
   three-`GROUP BY`-query shape in fix-loop iteration 1.
3. **A dedicated port/interface type for the row shapes `performance.ts`
   consumes, instead of importing them through the reviews facade.**
   Considered as the fix for the Phase 2 Minor finding above; not applied in
   this feature — the existing `container.reviewRepo` cross-module access
   pattern (already used by `AgentsService.stats()`) was judged sufficient
   for a single consumer, with a dedicated type deferred until a second
   consumer of these specific row shapes exists.
