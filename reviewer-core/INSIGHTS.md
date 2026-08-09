# INSIGHTS — reviewer-core

Accumulated engineering knowledge for this package: what worked, what didn't,
codebase-specific patterns, tool quirks, and open questions — kept OUT of
[AGENTS.md](AGENTS.md) under the ≤100-line / map-not-documentation rule.

Read at the start of every session per AGENTS.md, and updated at the end via
the `engineering-insights` skill — treat entries here as high-confidence
guidance unless AGENTS.md says otherwise. Append-only; entries must pass the
"cold read" test (actionable without re-investigation) — see
[../.claude/skills/engineering-insights/SKILL.md](../.claude/skills/engineering-insights/SKILL.md).

## What Works

- **Relocating a pure function INTO this package (WI11 of
  `docs/plans/l04-blast-radius-and-prepush-cli.md`) is a one-line re-export
  at the old location, not a breaking move.** `parseUnifiedDiff` moved from
  `server/src/adapters/git/diff-parser.ts` to `src/diff/parse.ts` (exported
  from `src/index.ts`); the old file became
  `export { parseUnifiedDiff } from '@devdigest/reviewer-core';`. All five
  of the server's existing import sites (`adapters/index.ts`,
  `adapters/mocks.ts`, `adapters/git/simple-git.ts`,
  `modules/reviews/diff-loader.ts`, `test/grounding.test.ts`) kept working
  with ZERO edits — confirmed via a full server unit-test run (129→133
  passing as other work landed concurrently, 0 new failures; the 6
  `indexer-pipeline.test.ts` failures are the pre-existing Windows flake,
  see `server/INSIGHTS.md`). Done specifically so the pre-push CLI
  (`mcp/src/cli.ts`) could reuse the SAME parser instead of writing a
  second implementation, per this package's own "no second implementation"
  rule in `AGENTS.md`.

## What Doesn't Work

_(to be filled in)_

## Codebase Patterns

_(to be filled in)_

## Tool & Library Notes

- **A file moved INTO this package that a file OUTSIDE the package still
  imports (via a re-export) breaks `vitest` unless `vitest.config.ts` gets
  a SELF-alias.** After relocating `parseUnifiedDiff` here, `test/
  run.test.ts` (which imports `server/src/adapters/mocks.ts` for its
  `Mock*Client` fixtures) started failing with `Failed to load url
  @devdigest/reviewer-core ... Does the file exist?` — `mocks.ts` pulls in
  the relocated `server/src/adapters/git/diff-parser.ts`, which now
  re-exports from the bare specifier `@devdigest/reviewer-core`, and Vite
  (unlike `tsc`/`tsx`, which read `tsconfig.json`'s `paths`) has no idea
  that specifier means "this package's own `src/`" without an explicit
  `resolve.alias` entry. Fix: add
  `'@devdigest/reviewer-core': path.resolve(__dirname, 'src')` to this
  package's OWN `vitest.config.ts`, mirroring `server/vitest.config.ts`'s
  alias for the same package pointed the other direction. Watch for this
  again any time a file that lives in `server/src/` (even indirectly, via
  test-only fixtures like `mocks.ts`) ends up importing something this
  package now owns.

## Recurring Errors & Fixes

_(to be filled in)_

## Session Notes

- 2026-08-09: WI11 of `docs/plans/l04-blast-radius-and-prepush-cli.md` —
  relocated `parseUnifiedDiff` here (new `src/diff/parse.ts`, exported from
  `src/index.ts`) so both the server AND the new pre-push CLI
  (`mcp/src/cli.ts`, built the same session — see `mcp/INSIGHTS.md`) share
  one implementation. `server/src/adapters/git/diff-parser.ts` reduced to a
  one-line re-export; zero edits to its five existing call sites. Needed a
  self-alias fix in this package's own `vitest.config.ts` (see Tool &
  Library Notes) that wasn't anticipated by the plan — the kind of thing
  that only surfaces by actually running the test suite, not by reading the
  diff.

## Open Questions

_(to be filled in)_
