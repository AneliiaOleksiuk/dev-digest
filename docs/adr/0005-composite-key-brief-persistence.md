# ADR 0005: Composite `(pr_id, head_sha)` key for `pr_brief`, spend guarded in-process only

- **Status:** Accepted
- **Date:** 2026-08-14
- **Context:** SPEC-03 PR Brief & Why Timeline — how a PR Brief is keyed in
  storage, and how concurrent generation for the same key is handled

## Context

`pr_brief` (`server/src/db/schema/reviews.ts:74-79` before this feature) was
scaffolding: a `pr_id`-primary-key table with one untyped `json` column,
never written by any reader or writer in `server/src`. The feature needs to
persist one brief **per (PR, commit)**, not one per PR — the Why Timeline
requires reading every brief a PR has accumulated across head SHAs, and a
brief is a snapshot of one `head_sha`, not of "the PR" in the abstract.
Because the table had never been written, changing its key cost nothing:
there were no rows to migrate and no reader to break.

Two questions had to be settled together, because they interact: how the row
is keyed, and how two simultaneous generation requests for the same key are
prevented from both paying for a model call.

## Decision

**Composite primary key `(pr_id, head_sha)`, not a surrogate `id` plus a
unique index.** It serves both access paths this feature needs from one
index: an exact `(prId, headSha)` lookup for the current-brief read, and a
`prId`-prefix scan for the Why Timeline. It also gives `onConflictDoUpdate`
a natural target, so "replace the brief for this SHA, never append a second
row for it" is enforced by the database itself rather than by service-layer
logic that could drift.

**The composite key makes the row idempotent; it does not make spend
idempotent — those are two different guarantees, and only the first is
provided by the database.** A second successful write for the same `(pr_id,
head_sha)` replaces the first (row-idempotent). Nothing about the primary
key stops two truly concurrent generation requests from both reaching the
LLM call and both paying for it; the later write simply overwrites the
earlier one. The actual spend guard is an in-process `Map<string,
Promise<BriefResponse>>` keyed by `` `${prId}:${headSha}` ``
(`server/src/modules/brief/service.ts:46-52`, the same shape
`OnboardingService` already uses for its own single-flight generation). A
second request for a key already in flight attaches to the same promise
instead of starting a new one. This guard is **single-process only** —
it inherits the single-API-process assumption `server/AGENTS.md` already
documents for `reapStaleRuns()`. Two API processes handling two concurrent
requests for the same `(pr_id, head_sha)` will both pay.

This failure mode — duplicate spend, one surviving row, last-writer-wins —
was surfaced explicitly as a scrutiny point for this plan's required
cross-model review and was accepted as-is rather than designed away: no
advisory lock, no `INSERT … ON CONFLICT DO NOTHING`-then-poll.

## Rationale

- **A separate `pr_brief_history` table alongside a single-row `pr_brief`
  was rejected.** It would require writing every brief twice and keeping the
  two in sync, for the sole benefit of a marginally simpler "current" lookup
  that a `(pr_id, head_sha)` index already serves on its own.
- **`pr_intent` was deliberately left alone**, not given the same
  multi-row treatment. Making intent multi-row would be a change to a
  shipped, populated table with live readers (`getIntentRecord`,
  `run-executor`); it isn't needed for this feature, and Brief persists the
  intent context it actually used at generation time regardless of whether
  `pr_intent` itself is single-row.
- **An advisory lock or poll-based dedupe across processes was rejected for
  this iteration**, not because the risk is illusory, but because the
  product already has one documented single-process assumption
  (`reapStaleRuns()`), and giving Brief a second, narrower one is a smaller
  addition to reason about than introducing a new cross-process
  synchronization primitive for a low-frequency, low-blast-radius failure
  mode (duplicate spend, not duplicate or inconsistent data — the losing
  write is simply discarded, and the surviving row is a valid brief).

## Consequences

- **The Why Timeline's per-entry lookups and the current-brief read share
  one index**, with no join and no second table to keep consistent.
- **`AC-13`'s "replace, never append" is a database guarantee**, not a
  service-logic invariant that a future code path could accidentally
  violate by calling `insert` instead of `upsert`.
- **Duplicate spend under concurrent generation is a known, accepted
  limitation**, not a defect to be fixed opportunistically. Revisiting it
  (an advisory lock, or a stronger cross-process dedupe) needs to be a
  deliberate decision, not a side effect of an unrelated change to
  `service.ts`.
- **The guarantee text a future reader needs is precise, not folk wisdom:**
  "the row is idempotent" and "spend is deduped" are different claims: the
  first is always true (database-enforced); the second is true only within
  one API process (in-memory, `inFlight` map). Conflating them would
  understate the real risk.

## Alternatives considered

1. **Surrogate `id` primary key + unique index on `(pr_id, head_sha)`.**
   Rejected — no functional advantage over a composite key here (no other
   table references a brief row by a synthetic id), and it would make
   `onConflictDoUpdate`'s target one step less direct for no benefit.
2. **Separate `pr_brief_history` table, single-row `pr_brief` kept as the
   "current" cache.** Rejected — double-write, sync burden, for a "current"
   lookup the composite-key index already provides without it.
3. **Cross-process concurrency guard (Postgres advisory lock, or
   `INSERT … ON CONFLICT DO NOTHING` then poll for the winner).** Rejected
   for this iteration. Scoped as a real, reversible follow-up if the
   duplicate-spend rate in practice turns out to matter — not designed away
   permanently, just not built now, in favor of shipping with the same
   single-process assumption the rest of the API already carries.
