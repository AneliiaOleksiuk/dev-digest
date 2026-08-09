# ADR 0003: Reuse `RunTrace.specs_read` for intent-resolved paths

- **Status:** Accepted
- **Date:** 2026-08-06
- **Context:** Intent Layer observability — which plan/spec files the
  classifier opened

## Context

Intent classification may read local `.md` files referenced in the PR
description (from the repo clone). Operators and the run-trace UI need to know
**which paths** were opened this run — contents must never be logged.

`RunTrace` already had a `specs_read: string[]` field that was hardcoded to
`[]` in the run executor. Adding a parallel field would widen the contract for
little gain.

## Decision

Populate `RunTrace.specs_read` with the **paths** of spec/plan files the intent
classifier actually read from the clone on a **fresh** classification this run.

- Paths only — never file contents.
- Populate **only when** `getOrClassify` returns `reused: false`.
- On a head-SHA cache hit (`reused: true`), leave `specs_read` empty for this
  run — those files were not opened again; claiming them would be a false
  claim about *this* run.

Helper: `specPathsFrom` in `intent-inputs.ts` (resolved `sources[]` entries
with `kind === 'spec_file'`).

Contract docblock on `RunTrace.specs_read`
(`vendor/shared/contracts/trace.ts`) documents the reuse: paths read anywhere
in the run pipeline (currently: intent classification), not necessarily fed to
the reviewer's prompt.

## Consequences

- Callers must thread the `{ record, reused }` result from `getOrClassify`
  (implementer deviation from a bare-record return).
- Trace consumers that assumed `specs_read` meant "chunks in
  `## Project context`" must read the updated field meaning — the array is
  provenance of files opened during the run, not a mirror of prompt sections.
- Future readers (e.g. project-context retrieval) can append to the same array
  if they also open files in-run; keep the "paths only, this run only" rule.

## Alternatives considered

1. **New `intent_specs_read` (or similar) field** — clearer naming, but
   another contract + mirror + UI slot for one list of paths.
2. **Always copy paths from the persisted intent record on reuse** — simpler
   wiring, but lies about I/O on cache hits.
3. **Log paths only in Live Log, omit from `RunTrace`** — loses a stable
   audit field on the persisted trace document.
