# INSIGHTS — e2e

Accumulated engineering knowledge for this package: what worked, what didn't,
codebase-specific patterns, tool quirks, and open questions — kept OUT of
[AGENTS.md](AGENTS.md) under the ≤100-line / map-not-documentation rule.

Read at the start of every session per AGENTS.md, and updated at the end via
the `engineering-insights` skill — treat entries here as high-confidence
guidance unless AGENTS.md says otherwise. Append-only; entries must pass the
"cold read" test (actionable without re-investigation) — see
[../.claude/skills/engineering-insights/SKILL.md](../.claude/skills/engineering-insights/SKILL.md).

## What Works

_(to be filled in)_

## What Doesn't Work

_(to be filled in)_

## Codebase Patterns

_(to be filled in)_

## Tool & Library Notes

- **`agent-browser click <sel>` / `find text <t> click` do not reliably
  trigger a React `onClick` on a wrapping element** (confirmed against
  `@devdigest/ui`'s `Dropdown` — the trigger's `onClick` lives on a `<div>`
  wrapping the visible `<button>`). Symptom: the command reports success,
  but a follow-up `screenshot`/`get count` shows the UI unchanged, and
  `get count "text=X"` itself always returns `0` (that selector engine
  doesn't support the `text=` pseudo-selector on `get`/`is` — only `find`
  and `click` do). Reliable alternative: `agent-browser eval` with
  `element.dispatchEvent(new MouseEvent('click', {bubbles:true,
  cancelable:true, view:window}))` on the actual DOM node — always opened
  the dropdown when the plain `click`/`find click` didn't.
- **React state updates from an `agent-browser eval` click are not visible
  to `document.body.innerText` checked synchronously in that same `eval`
  call** — the click's `return` in the same eval often reports the
  pre-update DOM, while a *separate* eval/screenshot command issued
  immediately after correctly sees the post-update DOM. This is React's
  render being scheduled async relative to the synchronous event handler,
  not a bug in the click. Don't trust an in-eval same-call check of
  post-click DOM state; issue `agent-browser wait <ms>` (e.g. 300-500ms)
  or a second separate command before asserting/screenshotting.
- **`agent-browser eval` shares one JS global scope across calls within a
  session** — a `const x = ...` in one `eval` invocation collides
  ("Identifier 'x' has already been declared") with the same name in a
  later `eval` in the same session. Wrap eval scripts in an IIFE
  (`(() => { ... })()`) to avoid top-level redeclaration errors across
  calls.
- **`agent-browser screenshot <path>` fails with `os error 3`
  ("system cannot find the path specified") if the target directory
  doesn't exist** — it does not create parent directories. `mkdir -p` the
  dir (e.g. `e2e/test-results/`) before the first screenshot of a session.

## Recurring Errors & Fixes

_(to be filled in)_

## Session Notes

- 2026-08-02: `agent-browser` was not installed in this Windows dev
  environment (contradicts the `client/INSIGHTS.md` 2026-07-31 note that it
  was absent) — installed globally via `npm i -g agent-browser &&
  agent-browser install` (downloads Chrome for Testing to
  `~/.agent-browser/browsers/`) specifically to get real-browser
  screenshots verifying the new `/skills` page and the Agent Editor Skills
  tab. See Tool & Library Notes above for the click/eval-timing quirks
  found while using it.

## Open Questions

_(to be filled in)_
