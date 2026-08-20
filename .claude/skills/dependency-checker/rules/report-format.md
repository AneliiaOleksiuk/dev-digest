# Report format

Use this exact section order for every run — a developer skimming should
find the same thing in the same place every time, and be able to jump
straight to "what do I do about this" at the end without reading the rest.

Write the full report to **both**:
- the chat response, and
- `docs/reports/dependency-report-<YYYY-MM-DD>.md` (create `docs/reports/`
  if it doesn't exist yet — it's a new, dated-snapshot doc category,
  distinct from the durable categories in `docs/` listed in AGENTS.md's
  docs index, so it doesn't belong under `adr/`, `features/`, or
  `reference/`).

If a report for today's date already exists, overwrite it — this is a
point-in-time snapshot, not an append-only log; keeping every historical
run isn't the goal, `git log` on the file already gives history for free
if the user commits it.

## Template

```markdown
# Dependency report — <YYYY-MM-DD>

## Executive summary
2-4 sentences: total packages scanned, combined installed size, headline
risk (e.g. "3 packages outdated by a major version, 1 high-severity
advisory, @devdigest/shared has drifted between its two mirrored copies").

## Package inventory
Table: package name | manager (pnpm/npm) | direct prod deps | direct dev
deps | total installed size.

## Internal dependency graph
Mermaid diagram per discovery.md's two edge types (solid = live tsconfig
path import, dashed = hand-mirrored vendor copy). Caption the dashed edges
explicitly as "not compiler-enforced, can drift silently."

## Size ranking
Top N heaviest *direct* dependencies across the whole repo (name, which
package(s) pull it in, size, prod/dev). Call out anything where a `dev`
dependency is surprisingly large — those don't ship, so their size is a
build/CI cost, not a runtime one; don't conflate the two when giving advice.

## Version consistency
Any dependency name pinned to different version ranges across packages.
Skip this section (say "none found") rather than forcing an empty table.

## Outdated dependencies
Per package, only entries where current != latest. Group by "patch/minor
behind" vs "major version(s) behind."

## Security advisories
Per package, only if the audit found something. Say "clean" for a package
with nothing, don't list it with an empty sub-table.

## Drift & risk flags
Anything discovered during the run that doesn't fit the tables above:
mismatches between AGENTS.md's claims and what's actually on disk (see
discovery.md), missing lockfiles, packages where node_modules wasn't
installed and sizing was skipped, hand-mirrored files that have visibly
diverged (compare the two vendor copies' content if the diagram flagged
one).

## Recommendations
Numbered, ordered by impact-for-effort (cheapest, highest-impact fixes
first — not alphabetical, not by section). Each line: the action, the
package(s) it applies to, and the one-sentence reason. Keep this to
concrete, single-package or single-dependency actions a developer could
pick up individually — not "improve dependency hygiene" style filler.
```

## What NOT to do

- Don't pad a clean section with reassurance text ("Great news, no issues
  found!") — a terse "None found." reads faster and doesn't train the
  reader to skim past real findings later.
- Don't repeat the same number in three different units "for clarity" —
  pick MB (one decimal) for the report and stay consistent.
- Don't bury the recommendations at the very end behind six other sections
  if a developer clearly only wants the punch list — the section order
  above is fixed, but it's fine to also put a 2-3 line "top 3 actions" callout
  right under the executive summary if the recommendations list ends up long.
