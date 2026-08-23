# ADR 0008: Legacy CI installations are frozen on their unnamespaced layout forever, never migrated

- **Status:** Accepted
- **Date:** 2026-08-23
- **Context:** SPEC-05 — Multiple review agents on one repository in CI
  (`specs/SPEC-05-multi-agent-ci-per-repo.md`, decision D-3, acceptance
  criterion AC-14) — what happens to an installation exported before
  namespacing existed, once namespacing ships

## Context

SPEC-05 gives every new CI installation its own namespace under
`.devdigest/<ns>/`, its own workflow file
(`.github/workflows/devdigest-review-<ns>.yml`) and its own ingest secret
(`DEVDIGEST_INGEST_TOKEN_<NAMESPACE>`) — see
[docs/adr/0009](0009-per-agent-workflow-file-not-matrix.md) for why each
agent gets its own file at all. That immediately raises a second question:
what happens to an installation that was exported **before** this shipped,
still sitting on SPEC-04's single unnamespaced layout
(`.devdigest/agents/`, `.devdigest/skills/`,
`.github/workflows/devdigest-review.yml`, the bare `DEVDIGEST_INGEST_TOKEN`
secret)?

The tempting answer is "migrate it onto a namespace the next time it's
re-exported" — deriving a namespace from the agent's name and committing
the namespaced files in place of the old ones, same as an ordinary
"Update CI config" flow. That answer does not actually work, for a reason
specific to this module's only GitHub-writing primitive:
**`GitHubClient.commitFiles`** (`server/src/adapters/github/octokit.ts:264`,
its shape declared in `server/src/vendor/shared/adapters.ts:134-141`) takes
a plain `files: CommitFile[]` list of paths to create-or-overwrite, layered
via `createTree({ base_tree: parentCommit.data.tree.sha, ... })` on top of
the branch's existing tree. There is no delete entry in `CommitFilesPayload`
and nothing in `service.ts` ever asks the GitHub adapter to remove a path —
every commit this module makes is strictly additive over the parent tree.

A "migration" that generates namespaced files and commits them therefore
would not *replace* the legacy files — it would **add a second, parallel
file set alongside the first**. The old
`.github/workflows/devdigest-review.yml` would keep existing in the
repository, still committed, still a valid GitHub Actions workflow, and
GitHub would keep running it on every future pull request regardless of
what DevDigest's own database now believes about that installation's
layout. The old `.devdigest/agents/*.yaml` manifest would keep existing
too, so the *legacy* runner invocation (still triggered by the still-live
old workflow) would keep finding it and keep running — reading a directory
the "migrated" installation no longer writes to, using a workflow the
studio no longer thinks is current, and reporting under a secret name
(`DEVDIGEST_INGEST_TOKEN`) the user would have no reason to keep pasting
once they believed the migration was complete. The result is not a clean
migration; it is a repository stuck running **two** DevDigest workflows for
one nominal installation, one of which is silently orphaned and will start
failing the moment its ingest token stops being maintained.

## Decision

**A CI installation's layout is decided once, at first install, and never
changes for the rest of that installation's life — including for every
installation that already existed before this Spec shipped.** There is no
migration path, prompted or automatic, from legacy to namespaced, ever —
not on re-export, not on "Update CI config" (the same route, same body
shape as a first install), not by any background job.

Modeled as data, not as a branch in generator code
(`server/src/db/schema/ci.ts`'s `ci_installations.namespace`, a **nullable**
column with **no default** and **no backfill**):

```ts
namespace: text('namespace'),
// NULL means legacy — an installation created before this column existed,
// by construction. Never migrated, re-namespaced or re-keyed.
```

Every row that existed when this column was added is `NULL` by
construction — legacy-ness is a fact about *when a row was inserted*, not a
flag anyone sets. `CiService.resolveLayout`
(`server/src/modules/ci/service.ts`) is the one place that reads it: for an
installation that already exists, it reuses that row's own persisted
`namespace` (and `manifestPath`) **verbatim**, however many times the agent
has since been renamed — there is no code path in `resolveLayout`, `install`,
or the zip-export path that ever re-derives or overwrites an existing row's
`namespace`. The Drizzle adapter's `onConflictDoUpdate` `set` clause
structurally omits `namespace` on every update
(`repository.drizzle.ts`), the same treatment already given `tokenHash` —
not just "the code currently never passes a different value", but "the SQL
statement itself cannot rewrite the column even if it did."

## Rationale

- **The blocking fact is `commitFiles`' additive-only shape, not a
  simplicity preference.** A migration that could actually retract the old
  workflow file and old manifest path would need a GitHub adapter capable
  of expressing a delete inside a commit's tree (the Git Trees API supports
  `{ mode: '100644', sha: null }` as a delete entry; nothing in this
  codebase's `GitHubClient` port or its Octokit adapter exposes that). Until
  that capability exists, "migrate" and "leave the old workflow still
  running, unmaintained" are the only two options a commit-only adapter can
  produce — and the second one is strictly worse than never attempting a
  migration at all.
- **Freezing is the option that requires no new capability and cannot
  silently misbehave.** A nullable column with no default, read back
  verbatim, cannot drift into "kind of migrated" the way a generator
  branch guarded by a runtime flag could. There is no state where an
  installation is namespaced in the database but the repository still runs
  the old workflow, because the database is never told to change for an
  existing row in the first place.
- **A silent rewrite of a repository DevDigest does not own is the wrong
  default even if the adapter *could* delete.** The committed files live on
  a branch a human opened as a pull request from; removing a file out from
  under that PR without the user's awareness is the same class of surprise
  this module already refuses elsewhere — Install never deletes another
  installation's files (AC-8), the shared PR is never retitled out from
  under the user (E-3, [ADR 0009](0009-per-agent-workflow-file-not-matrix.md)'s
  companion decision), and a token is never rotated without an explicit
  delete-and-re-export (ADR 0007). "Freeze, and let the user delete and
  re-export the installation themselves if they want the new layout" keeps
  every mutation of a legacy installation an explicit, visible act by the
  person who owns the repository.

## Consequences

- **A repository can permanently host a mix of layouts** — one legacy
  unnamespaced installation alongside any number of namespaced ones is a
  normal, permanent steady state, not a transitional one that "should"
  eventually converge. The legacy runner reads `.devdigest/agents/`, each
  namespaced runner reads `.devdigest/<ns>/agents/`, and neither directory
  ever gains a second manifest, so both keep starting indefinitely
  (`agent-runner/src/manifest.ts:37-45`'s "exactly one manifest per
  directory" rule is satisfied per namespace, unchanged from AC-15).
- **The only way to move a legacy installation onto a namespace is delete
  and re-export** — an explicit act by the user, functionally identical to
  the existing delete-and-re-export remedy ADR 0007 documents for token
  rotation. This leaves the legacy `.devdigest/agents/`,
  `.devdigest/skills/`, `.devdigest/memory.jsonl` and
  `.github/workflows/devdigest-review.yml` files sitting in the
  repository, uncommitted-from, exactly as `DELETE
  /ci/installations/:id` already leaves any installation's files behind
  today (SPEC-04's known limitation, unchanged).
- **A future reader must not "helpfully" wire up a migration path**
  believing frozen-forever was an oversight — it is a direct consequence of
  `commitFiles` having no delete primitive, and adding one is a
  prerequisite this decision explicitly did not build, not an accident.
- **This is a permanent commitment, not a v1 gap awaiting a v2.** Nothing
  in SPEC-05 records "migrate legacy installations" as a deferred item —
  it is out of scope by decision (D-3), not by omission.

## Alternatives considered

1. **Migrate in place on re-export, committing namespaced files and
   removing the old ones.** Rejected — not implementable with this
   module's actual GitHub-writing primitive; `commitFiles` cannot delete a
   path, so this would strand the old workflow file still committed and
   still running (see Context).
2. **Add delete capability to the GitHub adapter, then migrate.** Considered
   and rejected for this iteration — a real capability change to
   `GitHubClient`/`octokit.ts`, well beyond a namespace-derivation feature,
   and still leaves the harder question of a migration mid-flight (a
   workflow run in progress against the old path while the migration
   commits) unaddressed. Worth reconsidering only if a real user need for
   migration emerges.
3. **Prompt the user to opt into a migration**, rather than doing it
   silently. Rejected as scope creep for this iteration — same underlying
   delete-capability blocker as #1, plus a new confirmation UI this Spec's
   simplicity constraints (no new route, no new client page,
   "prefer one behaviour over a setting") explicitly steer away from.
4. **Freeze forever (chosen).** No new GitHub capability required, no
   migration state machine, no way for the database and the repository to
   silently disagree about an existing installation's layout.
