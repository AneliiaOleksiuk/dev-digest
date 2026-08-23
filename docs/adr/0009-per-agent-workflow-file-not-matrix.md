# ADR 0009: Each agent gets its own namespace and its own workflow file, not one workflow matrixed over agents

- **Status:** Accepted
- **Date:** 2026-08-23
- **Context:** SPEC-05 — Multiple review agents on one repository in CI
  (`specs/SPEC-05-multi-agent-ci-per-repo.md`, acceptance criteria AC-5,
  AC-18, AC-21) — how N agents installed on one repository each get their
  own independent GitHub Actions check run

## Context

SPEC-04 shipped one workflow per repository
(`.github/workflows/devdigest-review.yml`), generated with a
**workflow-level** `permissions:` block computed from a single agent's own
`post_as` setting — `{ contents: read, pull-requests: write }` normally,
narrowed to `{ contents: read, pull-requests: read }` when
`post_as === 'none'` (`constants.ts`'s `PERMISSIONS_POST` /
`PERMISSIONS_NO_POST`, `workflow.ts:71`). Crucially, **no job ever carries
its own `permissions:` override** — the generator never emits one, and the
hand-edited-override re-validator (`workflow-validate.ts`) refuses any
submitted override that adds one (`'permissions' in job` →
`job_level_permissions`). The workflow-level block is the single audited
surface for what this workflow is allowed to touch in the target
repository; that is a deliberate simplicity constraint, not an oversight.

SPEC-05 needs N agents on one repository, each producing its own
independent GitHub Actions check run — a distinct entry in the pull
request's checks list, independently settable as a required check in
branch protection. GitHub Actions offers a natural-looking way to do that
inside **one** workflow file: a `strategy: matrix:` job, templated once and
instantiated once per agent, each matrix cell showing up as its own named
job/check.

## Decision

**Every installation gets its own, independently generated workflow file**
— `.github/workflows/devdigest-review-<ns>.yml` for a namespaced
installation, keeping the legacy `.github/workflows/devdigest-review.yml`
filename for a frozen pre-SPEC-05 one (see
[ADR 0008](0008-legacy-ci-installations-frozen-forever.md)). `workflow.ts`'s
`buildWorkflow` is called **once per installation**, computing that
installation's own `permissions:` block from that installation's own
`post_as` — never a shared file with a matrix or multiple named jobs
serving more than one agent.

## Rationale

- **GitHub Actions permissions are set once per workflow (or, if allowed,
  per job) — never per matrix cell.** A `strategy: matrix:` job cannot
  declare different `permissions:` for different matrix values; the
  `permissions:` block that governs a matrixed job is whatever is declared
  at the job (or workflow) level, applying identically to every cell. A
  matrix over N agents with different `post_as` settings would therefore
  need **one shared `permissions:` block wide enough for the union of every
  agent's requirement** — in practice always
  `{ contents: read, pull-requests: write }`, because a single
  `post_as: 'github_review'` agent anywhere in the matrix forces it. Every
  other agent sharing that matrix — including one explicitly configured
  `post_as: 'none'` specifically to stay read-only — would silently run
  with `pull-requests: write` it never asked for and structurally cannot
  avoid while sharing the file. That is exactly the failure mode SPEC-04's
  least-privilege design (and [ADR 0007](0007-ci-ingest-bearer-token-hash-lookup.md)'s
  neighboring blast-radius reasoning) exists to prevent.
- **The obvious alternative — job-level permissions per agent in one shared
  file — reopens a surface this module already closed on purpose.** GitHub
  Actions *does* support per-job `permissions:` distinct from the
  workflow-level block; the reason a matrix (or several named jobs in one
  file) can't use that here is that this module's own generator and
  re-validator **already forbid emitting job-level `permissions:` at all**
  (`workflow-validate.ts`'s `job_level_permissions` check), so that a
  human auditing a generated workflow has exactly one place to read what it
  can do — not N places, one per job, that could each say something
  different. Solving the matrix's permissions problem by allowing job-level
  overrides would trade away that single-audit-surface property for every
  installation on the repository, not just the multi-agent ones. Per-agent
  **files** keep "one workflow-level `permissions:` block per file, easy to
  audit" intact — the audit surface just multiplies by file count instead
  of being weakened per file.
- **Per-agent files also keep every other SPEC-04 invariant scoped
  correctly with zero new generator branching.** The fork guard, the
  SHA-pinned actions, the `pull_request`-only trigger, the exact
  `RUN_COMMAND`, the AC-24 override re-validation — all of these are
  already expressed **per generated workflow**. A matrix would have forced
  each of those checks to also become "does this hold for every cell of the
  matrix," multiplying the re-validator's complexity for a shape this
  module's simplicity constraints (`constants.ts` as the one source of
  truth, no `LayoutStrategy` seam) explicitly steer away from. One file per
  agent needs none of that — the existing single-workflow logic runs
  unchanged, once per installation.

## Consequences

- **N agents means N separate workflow files, N separate check runs, and N
  separate required-status-check entries** a repository owner must add to
  branch protection individually if they want more than one agent's review
  to gate merging — there is no single "DevDigest" check to require once.
  The CI tab does not yet surface the resulting check name per installation
  to make that easier (SPEC-05's OQ-3, left open by decision, not by
  omission).
- **N agents on one pull request event means N independent workflow runs, N
  LLM calls and N ingest POSTs**, with no cap anywhere in the system
  (SPEC-05's E-12/OQ-4) — fan-out and cost scale linearly with agent count,
  against an ingest rate limit (`INGEST_RATE_LIMIT`, 60/min) sized when one
  agent per repository was the only possibility.
- **The shared runner bundle (`.devdigest/runner/index.js`) is unaffected
  by this decision** — it stays one file per repository regardless of how
  many workflow files reference it (AC-6); this ADR only concerns the
  workflow file and its `permissions:` block, not the runner bundle's own
  sharing model.
- **A future reader must not "simplify" this back into one matrixed
  workflow** believing per-agent files are redundant boilerplate — the
  redundancy is what keeps a `post_as: 'none'` agent's `permissions:`
  genuinely read-only when it shares a repository with an agent that posts
  reviews.

## Alternatives considered

1. **One workflow, one job, matrixed over installed agents.** Rejected —
   GitHub Actions cannot vary `permissions:` per matrix cell; the shared
   block would have to be the union of every agent's requirement, silently
   widening a read-only agent to `pull-requests: write`.
2. **One workflow, one named job per agent (not matrixed), each with its
   own job-level `permissions:`.** Rejected — requires reintroducing
   job-level `permissions:` overrides, which this module's generator and
   re-validator already forbid by design, for the same single-audit-surface
   reason ADR/Spec text elsewhere treats as load-bearing.
3. **Per-agent files, one `permissions:` block each (chosen).** No matrix,
   no job-level permissions override, no new generator branching — the
   existing single-installation workflow-generation logic simply runs once
   per installation instead of once per repository.
