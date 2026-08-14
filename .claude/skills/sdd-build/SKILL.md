---
name: sdd-build
description: "Runs an already-approved Development Plan through implementer -> plan-verifier (Critical-only fix-loop, capped at 3 iterations) -> doc-writer. Pauses for approval after every phase. Use when the user asks to run/build/execute a Development Plan under docs/plans/, or invokes /sdd-build. Never invokes spec-creator or implementation-planner -- both run separately, by hand, before this skill starts. Skips test-writer; runs plan-verifier on Sonnet for this skill's calls only (cost override -- the plan-verifier persona itself stays on Opus)."
---

# SDD Build

Orchestrates the back half of this repo's SDD agent chain
([agents/README.md](../../../agents/README.md)) against a Development Plan
that already exists and is already approved. Does not create or edit a
Spec or a Development Plan itself -- `spec-creator` and
`implementation-planner` are run manually, outside this skill, before it
starts.

## Input

The path to a Development Plan under `docs/plans/`, given as the
argument to `/sdd-build <path>` or named directly in the request. If no
path is given, or the named file doesn't exist, ask the user for the
correct path before doing anything else -- never guess, and never fall
back to running `spec-creator` or `implementation-planner` to produce one.

Read the plan file fully before starting.

## Phase 1 -- Build

Invoke the `implementer` agent (foreground), with the Development Plan's
content inlined in the prompt (per `agents/README.md`'s context-handoff
convention -- don't make it re-read the file when you already have it).

Show the user its Implementation Report (or a concise summary if long) and
get explicit approval before continuing to Phase 2. If the user requests
changes, relay them back to `implementer` rather than starting a fresh
instance.

## Phase 2 -- Verify

Invoke `plan-verifier` (foreground) with `model: sonnet` passed as an
override for this call only -- do not edit `agents/plan-verifier.md` or its
mirrors to make this permanent, that persona's default stays Opus for
anyone invoking it directly. Inline the Development Plan and the diff/
Implementation Report per the same context-handoff convention. There is no
`test-writer` Test Report in this workflow -- don't mention or wait for one.

Show the user the full Plan Verification output (both phases). Get
explicit approval before continuing.

### Fix-loop (max 3 iterations)

Loop back to `implementer` -- same plan -- when either is true:
- Phase 1 verdict is `FAIL` or `PASS WITH REQUIRED FIXES` (treat required
  fixes as blocking)
- Phase 2 has any `Critical` finding (`Major`/`Minor`/`Nit` never block --
  surface them to the user, then continue)

Give `implementer` the exact failing traceability rows / Critical findings
verbatim, not a paraphrase. After it reports the fix, re-run Phase 2
(`plan-verifier`, Sonnet override) from scratch -- never assume the fix
worked without re-checking.

State the iteration count out loud each time (e.g. "Fix-loop iteration 2 of
3"). If still unresolved after 3 iterations, stop, report the unresolved
items plainly, and wait for the user's decision -- never start a 4th
iteration silently.

Get explicit approval before starting each new fix-loop iteration, same as
any other phase.

## Phase 3 -- Docs

Only once Phase 1 = `PASS` and Phase 2 has no `Critical` findings: invoke
`doc-writer` (foreground), inlining the shipped diff, the Development Plan,
and `plan-verifier`'s Phase 2 findings section.

Show the user what was written and where. Close out with a short summary:
what shipped, what's now documented, and any non-blocking `Major`/`Minor`
findings from Phase 2 that were noted but not fixed.

## Rules

- Never invoke `spec-creator` or `implementation-planner` -- run manually,
  outside this skill.
- Never invoke `test-writer` -- intentionally out of scope here (cost).
- Never skip an approval checkpoint, even when a phase looks obviously
  fine.
- Never exceed the 3-iteration fix-loop cap without stopping to ask.
