# INSIGHTS — root

Accumulated engineering knowledge for this repo: what worked, what didn't,
codebase-specific patterns, tool quirks, and open questions — kept OUT of
[CLAUDE.md](CLAUDE.md) under the ≤100-line / map-not-documentation rule.

Read at the start of every session per CLAUDE.md, and updated at the end via
the `engineering-insights` skill — treat entries here as high-confidence
guidance unless CLAUDE.md says otherwise. Append-only; entries must pass the
"cold read" test (actionable without re-investigation) — see
[.claude/skills/engineering-insights/SKILL.md](.claude/skills/engineering-insights/SKILL.md).

## What Works

_(to be filled in)_

## What Doesn't Work

_(to be filled in)_

## Codebase Patterns

- **Why no monorepo tooling (pnpm workspaces / turborepo):** this is a course
  starter — each package is meant to be readable and runnable in isolation
  without a build orchestrator to learn first. Cross-package types are shared
  via tsconfig path aliases instead.
- **Why `@devdigest/shared` is hand-copied instead of a real package:** same
  reason — no workspace, no publish step. The trade-off is real drift risk
  (`server/src/vendor/shared/adapters.ts` still has a stale `apps/api/` path
  comment from whatever repo it was copied from) with no tooling to catch it.

## Tool & Library Notes

_(to be filled in)_

## Recurring Errors & Fixes

_(to be filled in)_

## Session Notes

_(to be filled in)_

## Open Questions

- **`reviewer-core/` is on npm while everything else is on pnpm:** unclear
  from the code — most likely an artifact of how the package was bootstrapped
  separately. Worth normalizing to pnpm if it ever causes friction; until then
  it's a known, harmless inconsistency, not a bug to "fix" reflexively.
