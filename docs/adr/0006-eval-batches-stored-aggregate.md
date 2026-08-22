# ADR 0006: `eval_batches` stores its aggregate as an immutable snapshot, not a live derivation

- **Status:** Accepted
- **Date:** 2026-08-20
- **Context:** SPEC — Eval Pipeline (`specs/eval-pipeline.md`, decision D-3) —
  what level of storage sits between "one case's one run" and "the whole
  set", and whether a batch's aggregate score is computed on read or stored
  once at close time

## Context

The eval scaffolding shipped with two tables: `eval_cases` (one gold-set
case) and `eval_runs` (one case's result on one execution). There was no
level in between. The homework's required "compare agent v6 → v7" view
needs exactly that missing level: one execution of an owner's *whole* case
set, at one pinned agent version, with an aggregate score attached to it —
something neither table alone represents.

`eval_runs.case_id` is `NOT NULL` and cascades on delete from `eval_cases`
(`server/src/db/schema/eval.ts:87-89`, `onDelete: 'cascade'`). This is the
crux of the decision: any design that computes a batch's aggregate by
querying and grouping the `eval_runs` rows that belong to it is,
transitively, a design that lets deleting a case rewrite a *past* batch's
score. Curating the gold set (deleting a bad or duplicate case, per D-6) is
an expected, ordinary action in this feature, not an edge case — so this
had to be designed for from the start rather than special-cased later.

## Decision

**Add a new `eval_batches` table that stores its aggregate as a persisted
value written once at batch-close time — not a view computed by aggregating
`eval_runs` on every read.**

`eval_batches` (`server/src/db/schema/eval.ts:40-83`) carries its own
`workspace_id` tenancy anchor, `owner_kind`/`owner_id`, the pinned
`agent_version`, `provider`/`model`, a `skills_fingerprint` snapshot of the
agent's linked skills at batch start, and the aggregate itself: `recall`,
`precision`, `citation_accuracy`, `cases_total`/`cases_passed`/
`cases_failed`, per-metric contributing-case counts
(`recall_cases`/`precision_cases`/`citation_cases`), `findings_total`,
`duration_ms`, `cost_usd`, and `error`. All of these are written once when
the batch finishes and never recomputed from `eval_runs` afterward.

`eval_runs.batch_id` (`server/src/db/schema/eval.ts:92`) is a nullable FK
to `eval_batches.id` with `onDelete: 'set null'` — deleting a batch detaches
its per-case run rows rather than deleting them, and deleting a case (which
cascades to that case's `eval_runs` rows via the pre-existing `case_id`
cascade) never touches any `eval_batches` row at all, because nothing reads
`eval_runs` to compute a batch's stored numbers.

## Rationale

- **The only alternative that avoids a second table — two nullable columns
  directly on `eval_runs` (`batch_id`, `agent_version`), with the
  compare/dashboard view grouping and aggregating the surviving rows — was
  rejected.** It is the minimal schema change, but it inherits
  `eval_runs.case_id`'s `ON DELETE CASCADE` as a correctness bug by
  construction: deleting one case would retroactively shrink or shift the
  aggregate of every past batch that ever included it, silently rewriting
  history the compare view is supposed to be a stable record of. This is
  spec edge case E-3, "Deleting a case rewrites history"
  (`specs/eval-pipeline.md`, Edge cases).
- **The cost is accepted, not hidden.** The aggregate is, in principle,
  computable by summing the per-case `eval_runs` rows a batch produced — it
  is stored a second time anyway. That duplication buys two things a live
  aggregation cannot: immutability (a closed batch's score cannot change
  because of an unrelated later action, i.e. curating the gold set), and
  read cost (the compare/dashboard view reads one row per batch instead of
  aggregating a `GROUP BY` over a growing, mutable `eval_runs` table on
  every load).
- **`eval_batches` gets its own `workspace_id`, `eval_runs` still does
  not.** `eval_runs` was already scaffolding with no tenancy column of its
  own (`server/src/db/schema/eval.ts:8-11`); giving the new batch table a
  first-class tenancy anchor rather than inheriting the same gap keeps every
  batch read scopable directly, without a join through `eval_cases` or
  `eval_runs`.

## Consequences

- **A batch's `recall`/`precision`/`citation_accuracy`/`cases_*` are a
  measurement frozen at close time**, not a live query result. A future
  reader must not "simplify" the compare view by replacing the stored
  columns with an aggregation over `eval_runs` — doing so reintroduces
  exactly the case-deletion bug this ADR exists to avoid.
- **Two tables must be kept consistent by the batch-close code path**, not
  by the database. There is no trigger or generated column tying
  `eval_batches`'s aggregate back to the `eval_runs` rows that produced it;
  correctness depends on the service that closes a batch computing and
  writing both consistently in one transaction.
- **Deleting a batch is non-destructive to its per-case history.**
  `eval_runs.batch_id`'s `ON DELETE SET NULL` means the individual case
  results survive as orphaned (batch-less) runs rather than being deleted
  alongside the batch.
- **Implementation note:** the verification pass on this work item (Phase A)
  found `skills_fingerprint` needed a `NOT NULL DEFAULT '[]'::jsonb`
  (`server/src/db/schema/eval.ts:55-57`) and that `eval_runs` was missing
  `findings_total`/`error` columns to mirror `eval_batches`'s shape
  (`server/src/db/schema/eval.ts:99,102`). Both are shape refinements to the
  same tables this ADR covers, not changes to the D-3 decision itself — the
  stored-aggregate tradeoff above is unaffected by either fix.

## Addendum (Phase C fix-loop, 2026-08-21) — write mechanism corrected, decision unchanged

This decision — a stored, immutable aggregate rather than a live derivation
over `eval_runs` — is unaffected by what follows. What changed is *how* that
stored row gets written, and it is recorded here because Phase C's
implementation of the batch runner (`docs/plans/eval-pipeline.md` WI7)
initially got the write mechanism wrong in a way `plan-verifier` caught.

The first cut opened an `eval_batches` row **before** any case ran — a
placeholder (`status: 'failed'`, every count `0`, every metric `null`) —
then overwrote it once the real aggregate was known. That placeholder was
not inert: `listBatchesForOwner` has no status filter and sorts `ran_at`
descending, so the placeholder **was** `batches[0]` — "the latest batch" —
for the whole in-flight window, and a process dying mid-batch left it
permanently in place, indistinguishable from a genuine all-failed batch.

The fix, and the mechanism this ADR's tables now describe in practice:
`EvalRepository.insertBatchWithRuns` is the *only* write to
`eval_batches`/`eval_runs` for a run, and it writes the `eval_batches` row
**already closed** — after every case has actually run and the aggregate is
computed — together with every one of that batch's `eval_runs` rows, inside
a single `db.transaction()` (`server/src/modules/eval/repository.drizzle.ts`
— the first use of `.transaction(...)` anywhere in `server/src`). A
still-running batch now has no row at all until it finishes, and a throw
partway through the transaction rolls back both the batch insert and every
run insert together, so a committed batch's `cases_total` can never diverge
from its actual persisted `eval_runs` row count.

**Residual, accepted tradeoff — not fully closed by the transaction.** The
transaction only protects what it itself commits. If the process crashes
*while* the batch is still executing — before the transaction begins — any
spend already incurred by cases that already completed has no persisted
record and cannot be recovered. Fixing that would mean writing each case's
cost as it finishes, which is exactly the earlier per-case-write shape this
fix moved away from, so it is accepted rather than hidden. See
`EvalBatchWrite`'s doc comment (`server/src/modules/eval/repository.ts`) and
[`docs/features/eval-pipeline.md`](../features/eval-pipeline.md#persisting-a-batch--the-fix-loops-single-atomic-transaction)
for the full detail and a diagram of the two phases (in-memory execution,
then the one atomic transaction).

## Addendum (Phase D, client) — the contributing-count UI echoes the same snapshot

A short client-side note, added because it is a direct consequence of this
ADR's decision rather than a new one: the Eval Dashboard, per-agent detail
view and the Agent Editor's Evals tab (`AgentEvalDetail.tsx`, `EvalsTab.tsx`)
all render each metric tile's contributing-case caption
(`recall_cases`/`precision_cases`/`citation_cases`, AC-30/UX-5) by reading
`dashboard.recent_runs[0]` — the **same** `eval_batches` row the server's
`buildDashboard` already used to populate `dashboard.current.*`. This was a
Major finding in the Phase D fix-loop's first iteration: the metric tiles
originally showed no contributing-count caption at all, and the tempting
fix — pairing the metric with `dashboard.cases_total` (the owner's whole,
still-growing case set) — would have been wrong precisely because of what
this ADR establishes: a batch's numbers are a **frozen snapshot** of the
case set as it stood at that batch's close, not a live view over the
owner's current cases. Captioning a frozen batch's mean with today's
(possibly larger) case count would misreport, e.g., "2 of 8 cases" as "2 of
20." The client's fix is therefore to always pull the count from the same
batch record its value came from (`recent_runs[0]`), never from a
separately-fetched, currently-live total — one more place where treating
the stored aggregate as authoritative, rather than re-deriving anything
live, was the only correct choice. See
[`docs/features/eval-pipeline.md`](../features/eval-pipeline.md#client--evals-ui-phase-d)
for the full UX decision.

## Alternatives considered

1. **Nullable `batch_id` + `agent_version` columns on `eval_runs`, aggregate
   computed on read.** Rejected — the case-cascade-delete-rewrites-history
   bug described above (E-3); also would have grown `eval_runs` with
   columns (`skills_fingerprint`, `provider`, `model`, cost/duration
   rollups) that only make sense once per batch, duplicated across every
   contributing run row instead of stored once.
2. **A materialized view or generated column deriving the aggregate from
   `eval_runs`.** Considered implicitly and rejected for the same reason as
   (1) — a materialized view refreshed after case deletion would still
   change a "past" batch's numbers; refreshing it only on batch-close and
   never again is equivalent to just storing the columns directly on a real
   table, which is what was built.
3. **No batch level at all — keep comparing sets of individual `eval_runs`
   filtered by `agent_version` in application code.** Rejected as not
   meeting the requirement at all: without a persisted set-level row there
   is no stable object to compare "v6" against "v7" as a whole, and every
   comparison would re-run the same fragile live aggregation this ADR
   avoids.
