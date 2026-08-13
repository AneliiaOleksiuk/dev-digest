# Fix Plan: SPEC-02 Onboarding Generator — Phase 1 FAIL remediation

Source: `plan-verifier`'s Phase 1 verdict (**FAIL**) against
[docs/plans/spec-02-onboarding-generator.md](spec-02-onboarding-generator.md),
run against commits `e8ca0ec` (implementer), `ea93e4d` (manual-verification
fix), `8f04d73` (test-writer). Full report is in this session's transcript;
this file exists so a fresh `implementer` invocation (this session or a
later one) can pick the work up directly without re-deriving the findings.

Read [specs/SPEC-02-onboarding-generator.md](../../specs/SPEC-02-onboarding-generator.md)
and the original Development Plan in full first — this fix plan assumes
that context and only adds the delta plan-verifier's Phase 1 requires.

## Execution mode

Same multi-agent chain as before: `implementer` (this plan) → `test-writer`
(new/updated tests for the fixed paths) → `plan-verifier` (re-run both
phases from scratch — never assume a fix worked without re-checking) →
`doc-writer` only once Phase 1 is `PASS` and Phase 2 has no Critical
finding. This is fix-loop iteration 1 of the 3-iteration cap.

## Required fixes

### FIX-1 — Commit the missing migration journal (blocking, do first)

**Problem (W2, most severe):** `server/src/db/migrations/0017_sweet_rachel_grey.sql`
is committed, but `server/src/db/migrations/meta/_journal.json` was never
updated to register it, and `meta/0016_snapshot.json` /
`meta/0017_snapshot.json` were never committed at all. `drizzle`'s
`migrate()` (`server/src/db/migrate.ts:30`) reads the journal to know which
migrations exist — on a fresh checkout, migration 0017 never runs, and the
`onboarding` table has none of the SPEC-02 columns (`status`, `provider`,
`model`, `tokens_in`, `tokens_out`, `cost_usd`, `call_count`, `index_sha`,
`files_indexed`, `index_status`). The feature does not exist outside this
one machine's disk state.

**Fix:** `git status` the `server/src/db/migrations/meta/` directory,
confirm `_journal.json`'s uncommitted diff and the two untracked snapshot
files are exactly what `pnpm db:generate` produced for 0017 (don't
regenerate — the migration SQL itself is already correct and committed,
only the journal/snapshot bookkeeping is missing), and commit all three
alongside the migration if they aren't already staged from a prior session.
Verify by dropping and recreating the test DB (or a scratch DB) and running
`pnpm db:migrate` from a clean journal state, then confirm the ten new
columns exist.

### FIX-2 — Grounding must cover section bodies, not only `links[]`

**Problem (AC-7, AC-10, W7):** `groundAndCapSection`
(`server/src/modules/onboarding/helpers.ts:168-196`) filters
`section.links` against `knownPaths(facts)`, but `section.body` — the
prose the model actually writes tasks/critical-path rows/reading-path
entries into — is never scanned. `capBulletItems` only counts list items
for the AC-14 render cap; it never inspects their content. A model that
invents a plausible-sounding file path in prose (not as a structured link)
ships straight into the persisted tour with no verification — this is the
exact failure mode AC-6/AC-7 exist to prevent, and the one already-fixed
precedent (`conventions/service.ts:141-166`) grounds the *whole* candidate
text, not just a structured sub-field of it.

**Fix:** Add a function that scans `section.body` for inline-code /
backtick-fenced path-shaped tokens (reuse `knownPaths(facts)` — the same
allowlist the link filter already builds) and drops the containing
list item (reuse the `capBulletItems`/`BULLET_RE` line-ownership logic
already in the file) when it names a path outside that set. Apply it to
`critical_paths`, `reading_path`, and `first_tasks` bodies — the three
kinds whose Spec text explicitly requires per-item/per-row grounding
(AC-7's "body, link, table row or task" language, AC-10's "each row shall
name a file from those chains"). `run_locally` already has its own
verbatim-match grounding (`groundRunLocallyBody`) and does not need this.

### FIX-3 — `getTour` must derive status instead of hardcoding it

**Problem (AC-17, AC-18, M1 — test-writer's own intentionally-failing
test):** `OnboardingService.getTour`
(`server/src/modules/onboarding/service.ts:85`) hardcodes
`status: 'never_generated'` on the no-stored-row path. The sibling
below-minimum generation branch (`service.ts:124`) already calls
`deriveStatus(indexState, facts)` for the exact same decision — a no-clone
repo's first page load is indistinguishable from an ordinary
never-generated repo, failing `server/test/onboarding.it.test.ts:234`
(`expected 'never_generated' to be 'no_clone'`).

**Fix:** In `getTour`'s no-row branch, collect facts the same way
`generate`/`runGeneration` does and call `deriveStatus(indexState, facts)`,
falling back to `never_generated` only when that returns `ok`/
`partial_index` (i.e. the repo is genuinely fine, just never generated).
This removes the duplicated status-derivation logic Phase 2 flagged as a
Major architecture finding in its own right — one domain concept, one
computation, per `deriveStatus`'s existing role as the module's single
source of truth.

### FIX-4 — Bounded-walk repos must report `partial`, and the page must render `status`/`reason`

**Problem, two related gaps:**
- **AC-15 (server half):** `helpers.ts:74-79`'s partial check only looks at
  `indexState.status === 'partial'`. A repo whose walk was bounded at
  `MAX_INDEXED_FILES` (5000, `repo-intel/pipeline/walk.ts:8-12`) but parsed
  cleanly reports `status: 'full'` from the indexer
  (`repo-intel/pipeline/full.ts:252-253` — `clean` doesn't consider the
  walk's `bounded` stat), so the Onboarding Generator has no signal to
  tell "full, 5000 files, nothing left out" from "full, 5000 files, and
  there were more". `IndexState` (`repo-intel/types.ts:42-49`) doesn't
  carry a `bounded` field today.
- **AC-16 (client half):** even where the server does produce a distinct
  `reason` (e.g. `repo_too_large`), the client never renders it.
  `OnboardingTourView.tsx:139-144` derives its empty/degraded copy from
  `sections.length === 0`, which is never true (the server skeleton always
  returns exactly five sections, `helpers.ts:334-341`) — so the whole
  `empty.*` message block in `client/messages/en/onboarding.json` is dead
  code on the main path, and `tour.reason` is computed server-side but
  never displayed.

**Fix:**
- Server: this needs either a small `repo-intel` facade change (expose the
  walk's `bounded` stat through `IndexState`) or, if that's judged out of
  this module's reach, a documented Open-question escalation rather than a
  silent skip — check with the product owner before touching `repo-intel`
  itself, since the Plan's own Non-goals forbid "any new repoIntel facade
  method" but a field addition to an existing return type is a narrower
  ask worth confirming first.
- Client: render a status/reason line in `OnboardingTourView`'s header
  sourced from `tour.status` + `tour.reason` directly (not inferred from
  `sections.length`), keeping the existing `EmptyState` component only for
  a genuinely empty section list.

### FIX-5 — Command provenance must reach the UI for LLM-authored `run_locally`

**Problem (AC-34):** `groundRunLocallyBody`
(`server/src/modules/onboarding/helpers.ts:105-117`) returns a bare
grounded string with no per-command source attribution — only the
deterministic skeleton path (`helpers.ts:304`) attributes commands to
their file. AC-34 requires the UI to "make clear they originate from the
repository" for every rendered command, and neither the LLM-authored body
nor any client copy currently states this for the real (non-skeleton)
tour.

**Fix:** Either (a) have the grounding step annotate each verified command
line with its source path (matching the skeleton's `(from
`path`)` convention) before persisting, or (b) add a one-line notice in
`SectionCard` specifically for the `run_locally` kind stating that these
commands are read directly from the repository's own files. (a) is
stronger since it's per-command, not just a blanket disclaimer — prefer it
unless it proves awkward against the model's own prose formatting.

### FIX-6 — Require confirmation before the *first* generation too

**Problem (S1):** AC-6's confirmation gate is scoped to "a repo that already
has a stored tour" (Regenerate), so `OnboardingTourView.tsx:52-58` calls
`generateMutation.mutate()` with zero confirmation on a repo's very first
generation — meaning repo excerpts reach the model provider with no
outbound-data notice on that first, most common path. The Spec's own
Non-goals state generation happens "only on an explicit, **confirmed** user
action, because it costs money," and NFR A04 names the confirmation step as
"the natural place to say what is sent" — neither is scoped to
regeneration only.

**Fix:** Route the first-generation action through the same
`RegenerateConfirmModal` (or a first-generation-specific copy variant of
it, if "regenerate" language reads wrong for a first-ever generation) so
every paid, outbound-data-sending call is confirmed, not only the ones that
overwrite an existing tour.

### FIX-7 — Test gaps (test-writer, after FIX-1..6 land)

Re-run `test-writer` once the above are fixed — new/changed code paths need
their own coverage, not a patch to existing assertions:
- **W10:** an actual nav-registry test (key `onboarding-tour`, `WORKSPACE`
  group, `:repoId`-templated href) — today only `activeKeyFor` is tested,
  never `client/src/vendor/ui/nav.ts`'s `NAV` array itself.
- **W11:** three missing component tests — AC-22 per-degraded-status
  skeleton rendering, AC-29's `cost_usd: null` case (must render `—`, never
  a fabricated number), and the AC-12 badge's label/tooltip text.
- New coverage for FIX-2's body-grounding function (an invented path
  inside prose, not a `links[]` entry, must be dropped) and FIX-3's fixed
  `getTour` (`no_clone` distinguishable from `never_generated` on the
  read-only path — this is the test that already exists and was
  intentionally left failing; it should go green with no changes needed to
  the test itself).

## Explicitly not in this fix plan

- The two Minor Phase 2 findings not tied to a failed AC (`RepoRepository`
  constructed directly in `service.ts` instead of behind a port; the
  nested-`<button>` HTML-validity issue in `SectionCard`) — real findings,
  worth fixing, but not blockers per plan-verifier's own verdict. Pick up
  in the same pass if convenient, otherwise track separately.
- The already-agreed, already-out-of-scope items: the `repo-intel`
  `depgraph.buildEdges` bug and the structured First-tasks-cards follow-up
  — both already recorded in [BACKLOG.md](../../BACKLOG.md) / discussed
  with the product owner, not part of this fix-loop.
- The unplanned Project Context (SPEC-01) wiring `plan-verifier` noted as
  present in `e8ca0ec` — that's SPEC-01's own already-verified work
  bundled into the same commit by an earlier session step, not something
  this fix plan touches.
