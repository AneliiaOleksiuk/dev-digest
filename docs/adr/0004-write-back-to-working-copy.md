# ADR 0004: In-app document editing writes back to the clone's working copy

- **Status:** Accepted
- **Date:** 2026-08-13
- **Context:** Project Context in-app document editing (SPEC-01 amendment,
  D-7)

## Context

The Project Context feature (`specs/SPEC-01-project-context.md`) lets a user
edit a discovered `.md` document from the product's Preview panel. The
document's canonical location is a file inside `repos.clone_path` — the same
local git clone the discovery walk reads, and the same clone
`GitClient.sync()` advances with `git fetch` + `reset --hard
origin/<branch>` (`server/src/adapters/git/simple-git.ts:78-101`). That
`reset --hard` is justified in-comment as *"safe here because we never
commit to or run code from the clone"* — precisely the assumption in-app
editing puts pressure on.

Two shapes were available for where a saved edit actually lands:

1. **Write back to the clone's working copy** — overwrite the same file the
   discovery walk already reads, with no versioning of the edit anywhere
   else.
2. **A DB-versioned copy** — store the edited text in the database (the
   shape `skill_versions` uses for skill bodies), keeping the on-disk file
   untouched until the user separately commits.

An earlier pass at this Spec (D-5) deferred in-app editing outright,
specifically because of this unresolved tension. D-7 supersedes that
deferral rather than reversing its underlying caution: the repo remains the
place documents are versioned; only the text editor moved into the product.

## Decision

Editing overwrites the file at its resolved path inside the clone — the
same file `discoverDocuments` walks — via `ProjectContextService.saveDocument`
(`server/src/modules/project-context/service.ts:157-207`). No document text
is ever persisted to the database; only attachment **paths** are stored
(`AC-17`, `AC-34`). The save performs no git operation of any kind: no
staging, no commit, no push, no branch or ref change (`AC-38`).

The durability consequence of that choice — an uncommitted edit lives only
in a clone the system otherwise resets — is accepted, not designed away,
and mitigated with a **precondition on the resync**, not a warning after
the fact: `GitClient.sync()` now runs `git status --porcelain
--untracked-files=all` before any fetch/reset and refuses with
`DirtyCloneError` while the clone is dirty (`AC-50`–`AC-53`; see
[`docs/features/project-context.md`](../features/project-context.md#clone-integrity-the-dirty-clone-resync-guard)
for the mechanism). Resolving that dirty state — committing or discarding
the edit — stays a git operation in the user's own tooling; this feature
adds no commit or discard action of its own.

## Consequences

- **Simpler mental model.** The document a user edits, the document the
  discovery walk lists, the document injected into a review prompt, and the
  document the user eventually commits are always the same file — there is
  no second copy that can drift from what's on disk.
- **No schema change.** Editing and creation add zero storage — no new
  table, no new column, no migration.
- **A created document behaves like any other file the moment it's
  written.** No "manually added" bookkeeping record exists; a newly created
  `.md` file enters the product only through the ordinary discovery walk on
  the next page load (`AC-42`), which also means it disappears from the
  product the same way any other file would if later deleted outside the
  app.
- **Durability is explicitly not offered.** An edit or a created document
  that is never committed can still be lost if the dirty-clone guard is
  bypassed some other way (e.g. a manual `git reset --hard` run outside the
  product), or if the clone directory itself is deleted. The product's only
  guarantee is that its own resync path won't be the cause.
- **The dirty-clone guard is now load-bearing correctness, not a
  convenience.** Any future code path that advances the clone's working
  tree (a second sync mechanism, a maintenance script) inherits the same
  obligation to check for uncommitted changes first, or this decision's
  safety property silently regresses.
- **Gitignored documents remain a known gap.** `git status --porcelain`
  omits ignored files, so a gitignored `.md` can be edited without the
  resync guard noticing — such an edit is neither blocked nor destroyed by
  a resync. Recorded as an accepted, pre-existing gap (the discovery walk
  already doesn't honor `.gitignore`), not one this decision introduces.

## Alternatives considered

1. **DB-versioned copy (the `skill_versions` shape).** Rejected. It would
   create two sources of truth for the same document — the DB copy shown
   in-app and the on-disk file the discovery walk, run-time injection, and
   the user's own git tooling all read — with no defined reconciliation
   step. It would also reopen the question this Spec's Non-goals
   deliberately closed: this feature performs no git operation, so a
   DB-versioned copy would need its own separate "publish to disk" step
   that doesn't otherwise exist here.
2. **Warn after the fact instead of blocking the resync.** Rejected in favor
   of a hard precondition. A warning shown after `reset --hard` already ran
   cannot undo the discarded edit — by the time the user sees it, the text
   is gone. Blocking the resync while the clone is dirty is the only shape
   that actually prevents the loss rather than reporting it.
- Both alternatives are also visible in the Spec text itself: D-5 records
  the original deferral this decision supersedes, and Non-goals records
  "Commit / discard actions for a dirty clone" as explicitly out of scope
  for the same reason alternative 1 was rejected — the repo, not the
  product, stays the place where documents are versioned.
