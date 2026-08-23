# ADR 0007: Concurrency via N single-element `executeRuns` calls, not a modified fan-out

- **Status:** Accepted
- **Date:** 2026-08-23
- **Context:** SPEC-04 Multi-Agent Review with live statuses — how the new
  batch orchestration achieves concurrent execution of N agents without
  destabilizing the existing single-agent review path

## Context

Before this feature, `POST /pulls/:id/review` with `{all: true}` resolved
every enabled agent and handed them to
`ReviewRunExecutor.executeRuns(workspaceId, pull, repo, jobs, logger)`, which
walks its `jobs` array in a **sequential** `for...await` loop
(`run-executor.ts:130-168` at the time the spec was written) — despite the
pre-authored UI copy already claiming "in parallel." The new Multi-Agent
Review feature needed *real* concurrency for an explicit, user-chosen subset
of agents, addressable as one batch.

`run-executor.ts` was declared out of scope for this feature (worktree A
boundary, `specs/SPEC-04-multi-agent-review.md` Non-goals) — it is the
existing single-agent execution path, already relied on by
`POST /pulls/:id/review`, and rewriting its internals to support batching
risked destabilizing a shipped, working feature for the sake of one that
hadn't shipped yet. Two other things needed to not regress once N agents ran
at once instead of one: **per-agent log isolation** (so a Columns view could
show independent live streams) and **per-batch shared pre-work** (intent
classification and diff loading, so N concurrent agents didn't reclassify or
re-diff the same PR N times).

## Decision

**`run-executor.ts` is not modified. `MultiAgentService` obtains concurrency
by calling `executor.executeRuns(workspaceId, pull, repoRow, [job], logger)`
once per agent — a single-element `jobs` array — fanned out through a
`p-queue` at `concurrency: 3`** (`multi-agent-service.ts:150-155`,
`constants.ts:20`, matching `platform/jobs.ts`'s existing `JobRunner`
default). `git diff --stat` on `run-executor.ts` is empty for this feature's
entire commit.

This single decision solves two problems at once, both by construction
rather than by new code:

- **Per-agent log isolation falls out for free.** `run-executor.ts` builds
  its `RunLogger` over `jobs.map(j => j.runId)` for *that* invocation. With a
  one-element `jobs` array, each agent's invocation gets a private log
  buffer instead of a buffer shared across the whole batch — exactly what
  the Columns view's independent per-column `LiveLogStream`s need, with zero
  new logging code.
- **Concurrency is delegated to a library already in the dependency tree.**
  `p-queue@8` is already a server dependency, already used for the same
  bounded-fan-out shape by `platform/jobs.ts`'s `JobRunner`. No new
  concurrency primitive was introduced.

Two remaining problems this decision *creates* — because calling
`executeRuns` N times instead of once means N independent per-agent code
paths run concurrently — were each fixed with the smallest possible change,
outside `run-executor.ts`:

1. **Shared intent classification, via ordering, not locking.**
   `MultiAgentService.executeBatch` `await`s **one**
   `intentService.getOrClassify(...)` call before starting the fan-out
   (`multi-agent-service.ts:129-148`). `getOrClassify` already reads
   `pr_intent` first and only classifies+upserts on a miss, so this ordering
   guarantees the row exists before any of the N per-agent `executeRuns`
   calls reaches its own intent resolution — zero new synchronization
   primitives, one `await` ahead of the fan-out.
2. **Shared diff loading, via a small bounded cache in `diff-loader.ts`.**
   `loadDiff` gained an in-memory `Map<string, Promise<UnifiedDiff>>` keyed
   by `` `${pull.id}:${pull.headSha}` ``, bounded to 16 entries (oldest-out),
   with a failed load evicted immediately so a later retry isn't poisoned
   (`diff-loader.ts:32-70`). This lives in `diff-loader.ts`, not
   `run-executor.ts` — its only consumer is the multi-agent fan-out, and it
   is a request-coalescing cache, not a correctness-critical store: a cold
   miss just re-does the (idempotent) load.

## Rationale

- **Smallest diff against a hard architectural boundary.** The spec declared
  `run-executor.ts` out of scope explicitly; any design that required editing
  it would have violated that boundary outright, not just added risk.
- **The existing per-job failure isolation is inherited, not reimplemented.**
  `executeRuns` already isolates one job's failure from the others inside a
  single invocation. Calling it N separate times means each agent's failure
  is isolated by construction — no new isolation logic was needed to satisfy
  "one agent crashing must not cancel, block, or hide the others' results."
- **A shared-context refactor was rejected.** An alternative considered (and
  rejected) was threading a shared `{ intent, diff }` context object through
  `run-executor.ts`'s signature so a single fanned-out call could reuse
  precomputed values across jobs. That would have required modifying
  `run-executor.ts`'s public signature — exactly the boundary this decision
  avoids — for a saving (avoiding two small, independently-justified fixes)
  that doesn't materialize once ordering (for intent) and a memoizing cache
  (for diff) solve the same two problems without touching it.
- **Fixing the sequential loop was rejected as out of scope for this
  feature.** The pre-existing `for...await` loop inside `executeRuns` still
  runs sequentially when it is ever called with a multi-element `jobs`
  array — e.g. from `POST /pulls/:id/review`'s existing `{all: true}` path.
  This feature does not touch that call site or that loop; it only ensures
  its own new call site (`MultiAgentService`) always passes a single-element
  array. Making `{all: true}` itself concurrent is a different, unstarted
  piece of work.

## Consequences

- **`run-executor.ts` carries zero risk from this feature** — every existing
  single-agent test and behavior is provably unaffected, verifiable with a
  plain `git diff --stat`.
- **Per-column log isolation required no new code** — it is a direct
  consequence of the single-element-`jobs`-array shape, not a feature that
  had to be built and tested independently.
- **Two small, narrowly-scoped fixes elsewhere carry the real complexity of
  "batching without a shared context"** — `IntentService`'s existing
  read-then-upsert cache (exploited via ordering) and `diff-loader.ts`'s new
  bounded memoization. Both are self-contained, testable in isolation, and
  neither required changing any function signature that `run-executor.ts`
  itself uses.
- **`POST /pulls/:id/review {all: true}` remains sequential.** Its own
  parallelism (or lack of it) is unaffected by this feature and was not
  revisited — the pre-authored UI copy claiming "in parallel" for that path
  was already inaccurate before this feature and remains so; this feature
  does not fix it, because that would require editing `run-executor.ts`.
- **The `diff-loader.ts` cache is process-local and unbounded in lifetime
  otherwise** — bounded to 16 entries specifically to avoid an unbounded
  `Map` growing for the lifetime of a long-running `pnpm dev`/production
  process; a future feature adding more concurrent diff consumers should be
  aware this cache exists and is shared.

## Alternatives considered

1. **Modify `run-executor.ts` to accept a shared pre-computed context
   (intent + diff) and/or to run its own `jobs` loop concurrently.**
   Rejected — violates the explicit worktree-A boundary; also the largest,
   riskiest diff against a shipped, working code path for the smallest actual
   gain, since the ordering + memoization fixes solve the same two problems
   without touching it.
2. **A dedicated `agent-runner` package separate from `server/src/modules/reviews`.**
   Considered in the spec's Non-goals and rejected outright — no such
   package exists in this repo, and creating one would be a much larger
   structural change than this feature's scope justified.
3. **Unbounded `Promise.all` over the caller-supplied agent list, with no
   concurrency cap.** Rejected on cost/DoS grounds (NFR-2) — a client-supplied
   agent list fanning out to N simultaneous unbounded LLM calls is a
   self-inflicted-cost vector; `p-queue` at `concurrency: 3` was adopted
   instead, matching the existing `JobRunner` default rather than inventing a
   new number.
