---
name: engineering-insights
description: "Captures non-obvious engineering learnings -- working solutions, dead ends, codebase patterns, library/tool quirks, recurring bugs and their fixes -- into the current package's INSIGHTS.md as they're discovered during a session. Use PROACTIVELY right after solving a non-trivial bug, discovering a library/tool quirk, making an architectural tradeoff, hitting a dead end worth avoiding next time, or at the end of any session (>30 min) that involved a real problem, decision, or discovery. Skip for trivial edits, typo fixes, or routine changes with nothing worth remembering."
---

# Engineering Insights

Appends session learnings to the package-local `INSIGHTS.md` so the next
session (by you or a teammate) inherits the knowledge instead of
re-discovering it. See [examples.md](examples.md) for good/bad entry pairs.

## When to write

Capture as you go -- the moment something non-obvious resolves, not just at
session end:

- A bug fix or workaround that wasn't obvious from the code
- A library/tool quirk (unexpected default, undocumented behavior, footgun)
- An architectural or design tradeoff you made and why
- An approach you tried that failed, and why it failed
- A codebase-specific convention or pattern you had to infer, not read

Also do a wrap-up pass at the end of any session longer than ~30 minutes that
hit a real problem, decision, or discovery. Skip wrap-ups for sessions of
routine edits (typo fixes, config tweaks, formatting) -- volume without
signal degrades the file for everyone who reads it later.

## Where to write

One `INSIGHTS.md` per package: root `INSIGHTS.md` (cross-cutting),
`server/INSIGHTS.md`, `client/INSIGHTS.md`, `reviewer-core/INSIGHTS.md`,
`e2e/INSIGHTS.md`. Pick the file that owns the code you were touching. If the
session spanned packages, put the cross-cutting takeaway in root and any
package-specific detail in that package's file.

## Sections (fixed -- do not invent new ones)

| Section | What goes here |
|---|---|
| **What Works** | Approaches/solutions that worked, worth reusing |
| **What Doesn't Work** | Failed approaches, dead ends, antipatterns -- as valuable as successes; don't skip this one |
| **Codebase Patterns** | Project-specific conventions and architecture decisions |
| **Tool & Library Notes** | Quirks/behaviors of dependencies discovered in practice |
| **Recurring Errors & Fixes** | Problems that came up more than once, and the fix |
| **Session Notes** | Dated one-line summary of what a session accomplished |
| **Open Questions** | Unresolved items needing further investigation |

Append to the matching section under the existing heading. **Never rewrite or
delete another entry.** If new information contradicts an old one, add a new
entry that says so explicitly rather than silently editing -- someone else
may be relying on the old entry being correct in its original context.

## Quality bar

Every entry must pass a "cold read" test: someone who has never seen this
session reads the entry and knows exactly what to do or avoid, with no
re-investigation. Name the specific file/function/library, the specific
symptom, and the specific fix or decision.

- Bad: "Promises can be tricky."
- Good: "`Promise.all()` on the ingestion pipeline times out after 30 items
  -- use `Promise.allSettled()` batched at 10 for that module."

If you can't make an entry that concrete, it isn't ready to write down --
keep investigating or drop it. One sharp entry beats three vague ones.

## Session Notes format

`- YYYY-MM-DD: <one line -- what was done, what was learned>`

## Keeping the file healthy

- **Append-only.** Resolve contradictions with a new note, never a silent
  edit.
- If a package's `INSIGHTS.md` passes roughly 200 entries, or one section
  gets unwieldy, propose splitting it into domain files (e.g.
  `INSIGHTS-auth.md`) referenced from that package's `CLAUDE.md`, instead of
  letting one file keep growing.
- If you notice an entry that's clearly stale (references deleted code, a
  superseded decision), flag it for removal instead of leaving it to rot --
  but don't delete someone else's entry without calling it out first.
- `INSIGHTS.md` is a living draft, periodically reviewed and edited -- not an
  append-forever log nobody revisits.
