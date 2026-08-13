---
name: run-plan
description: "Runs an already-approved Development Plan through the full back half of this repo's SDD chain: implementer -> test-writer -> plan-verifier (Critical/FAIL fix-loop, capped at 3 iterations) -> doc-writer. Pauses for approval after every phase. Use when the user asks to run/build/execute a Development Plan under docs/plans/ with tests included, or invokes /run-plan. Never invokes spec-creator or implementation-planner -- both run separately, by hand, before this skill starts. Unlike sdd-build, this skill does NOT skip test-writer -- use sdd-build instead when a Sonnet-cost, no-test-writer run is preferred."
---

# Run Plan

Orchestrates the full back half of this repo's SDD agent chain
([agents/README.md](../../../agents/README.md)) against a Development Plan
that already exists and is already approved. Does not create or edit a
Spec or a Development Plan itself -- `spec-creator` and
`implementation-planner` are run manually, outside this skill, before it
starts. This is the test-writer-inclusive sibling of `sdd-build`; pick this
skill when the checklist or the user explicitly wants a Test Report and
`plan-verifier`'s Phase 1 to check it, not just implementer's own self-check.

## Input

The path to a Development Plan under `docs/plans/`, given as the argument
to `/run-plan <path>` or named directly in the request. If no path is
given, or the named file doesn't exist, ask the user for the correct path
before doing anything else -- never guess, and never fall back to running
`spec-creator` or `implementation-planner` to produce one.

Read the plan file fully before starting. If the plan references a Spec
under `specs/`, read that too -- `test-writer`'s oracle independence
(deriving expected behavior from the plan/spec, not from the code it's
about to read) depends on this skill having read it first and being able
to inline it.

If the invoker asked for a commit after each phase (the default assumption
whenever this skill is invoked to demonstrate the pipeline end-to-end, e.g.
for a lab/checklist run), say so out loud at the start and follow the
per-phase commit rule below. Otherwise, do not commit anything -- same
git-safety default as everywhere else in this repo (never commit unless
explicitly asked).

## Phase 1 -- Build

Invoke the `implementer` agent (foreground), with the Development Plan's
content inlined in the prompt (per `agents/README.md`'s context-handoff
convention -- don't make it re-read the file when you already have it).

Show the user its Implementation Report (or a concise summary if long) and
get explicit approval before continuing to Phase 2. If the user requests
changes, relay them back to `implementer` rather than starting a fresh
instance.

**Per-phase commit (if requested):** commit the code changes with a message
naming the plan and Phase 1, before moving to Phase 2.

## Phase 2 -- Test

Invoke `test-writer` (foreground), inlining the Development Plan (and Spec,
if any) plus the shipped diff/Implementation Report from Phase 1. Do not
let it read `implementer`'s narrative as the source of expected behavior --
its oracle comes from the plan/spec, the diff is for wiring facts only
(import paths, exported names, fixtures), per `test-writer.md`'s own rule.

Show the user its Test Report (tests added, any behavior mismatches found
against the plan/spec). Get explicit approval before continuing.

**Per-phase commit (if requested):** commit the new test files with a
message naming the plan and Phase 2, before moving to Phase 3.

## Phase 3 -- Verify

Invoke `plan-verifier` (foreground). Inline the Development Plan, the diff/
Implementation Report, and `test-writer`'s Test Report -- per
`agents/README.md`, a non-empty `Behavior mismatches found` in that report,
once `plan-verifier` confirms it with its own evidence, becomes a Phase 1
`NOT MET` row, not something `doc-writer` ever sees unaddressed.

Show the user the full Plan Verification output (both phases). Get
explicit approval before continuing.

### Fix-loop (max 3 iterations)

Loop back to `implementer` -- same plan -- when either is true:
- Phase 1 verdict is `FAIL` or `PASS WITH REQUIRED FIXES` (treat required
  fixes as blocking)
- Phase 2 (architecture review) has any `Critical` finding (`Major`/
  `Minor`/`Nit` never block -- surface them to the user, then continue)

Give `implementer` the exact failing traceability rows / Critical findings
verbatim, not a paraphrase. If the failing row traces to a test that was
wrong rather than code that was wrong, route the fix to `test-writer`
instead -- never let `implementer` weaken or delete a test to make it pass
(same guardrail `test-writer.md` cites for itself). After the fix is
reported, re-run Phase 3 (`plan-verifier`, both phases) from scratch --
never assume the fix worked without re-checking.

State the iteration count out loud each time (e.g. "Fix-loop iteration 2 of
3"). If still unresolved after 3 iterations, stop, report the unresolved
items plainly, and wait for the user's decision -- never start a 4th
iteration silently.

Get explicit approval before starting each new fix-loop iteration, same as
any other phase.

**Per-phase commit (if requested):** commit the verifier's Plan Verification
report as a file if the invoker wants one persisted (otherwise the report is
chat-only, per `plan-verifier.md` -- ask which the invoker wants), with a
message naming the plan and Phase 3, before moving to Phase 4.

## Phase 4 -- Docs

Only once Phase 3's Phase 1 sub-verdict = `PASS` and its Phase 2 sub-report
has no `Critical` findings: invoke `doc-writer` (foreground), inlining the
shipped diff, the Development Plan, and `plan-verifier`'s Phase 2 findings
section.

Show the user what was written and where. Close out with a short summary:
what shipped, what's now tested, what's now documented, and any
non-blocking `Major`/`Minor` findings from Phase 2 that were noted but not
fixed.

**Per-phase commit (if requested):** commit the new docs with a message
naming the plan and Phase 4.

## Traceability matrix (when requested)

If the invoker asks for an AC -> task -> test -> commit matrix before merge
(e.g. a lab/checklist run), build it from: the Spec's AC IDs, the
Development Plan's work items (each already required to cite an AC),
`test-writer`'s Test Report (which test file covers which work item), and
the per-phase commit hashes from this run. Show it as a table and flag any
row with a gap (an AC with no task, a task with no test, a test with no
commit) plainly -- do not paper over a gap with "should be covered".

## Rules

- Never invoke `spec-creator` or `implementation-planner` -- run manually,
  outside this skill.
- Never skip `test-writer` -- that is the entire reason to pick this skill
  over `sdd-build`.
- Never skip an approval checkpoint, even when a phase looks obviously
  fine.
- Never exceed the 3-iteration fix-loop cap without stopping to ask.
- Never commit anything unless the invoker asked for per-phase commits (or
  this skill's own invocation context already establishes that, e.g. a
  lab/checklist run that explicitly requested it) -- this repo's default is
  no commit without an explicit ask.
