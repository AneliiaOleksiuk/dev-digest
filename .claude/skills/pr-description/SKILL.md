---
name: pr-description
description: "Drafts a terse, concrete pull-request description (Summary, Scope, Risks, Tests, Effort & Cost) before it's written to GitHub. Use PROACTIVELY whenever about to open a new PR (gh pr create) or edit an existing PR's body (gh pr edit --body) -- draft the text in chat first and get explicit user approval before writing anything to the actual PR. Never create a PR or modify its body before the complete proposed body has been shown to the user and explicitly approved. Creating an empty PR first does not bypass this requirement."
---

# PR Description

Builds the description for a pull request as a short, factual account of the
actual work -- not template filler, not a summary of intent. Applies every
time a PR is opened or its description is touched.

## The mandatory approval gate

**Never write a description straight to GitHub.** Show the full draft in the
chat first, formatted exactly as it will appear in the PR body. Only after
the user gives explicit approval (e.g. "looks good", "go ahead", an emoji
thumbs-up) may you call `gh pr create --body ...` / `gh pr edit --body ...`
or the equivalent API call. If the user asks for changes, revise and show
the draft again -- never apply a partial edit silently, and never treat
silence as approval.

This gate applies even if a project's `CLAUDE.md` pre-authorizes `gh pr
create` for opening the PR itself -- the body text still needs a separate
sign-off.

## Structure (five sections, always in this order)

### Summary
1-3 dense sentences: what changed and why. No scene-setting, no restating
context the reviewer already has from the diff or the linked issue.

### Scope
A concrete bullet list of what was actually changed, at file/module
granularity -- every bullet must be verifiable by reading the diff. Never
leave generic template checkboxes (`- [ ] Feature`, `- [ ] Bug fix`, etc.)
unchecked or as-is -- strip them out entirely and replace with real bullets.

### Risks
Short, concrete list of what could break and why -- e.g. migration
reversibility, behavior changes for existing consumers, edge cases the tests
don't cover. If there's genuinely nothing notable, write "None identified"
rather than inventing generic risk language to fill the section.

### Tests
What was actually run and verified this session, named specifically
(`pnpm typecheck`, the exact test files/suites, a manual API/browser check).
Never claim a verification step that didn't happen.

- **If the change touched UI**, include a screenshot from an actual browser
  check performed during the session (e.g. via the `run` skill or a
  headless-browser tool). Never fabricate or describe a screenshot that
  wasn't taken.
- `gh pr create`/`gh pr edit` cannot upload a local image into the body --
  GitHub only turns an image into a rendered attachment when it's dragged
  into the web UI's comment box (which assigns it a
  `github.com/user-attachments/...` URL). So when a screenshot exists,
  say so in the draft and ask the user whether they want to drag it in
  through the GitHub UI themselves, or whether the Tests section should
  just describe what the screenshot showed instead of embedding it.
- If no visual verification was possible (e.g. no browser tooling
  available in this environment) for a UI task, say that explicitly in
  the Tests section rather than omitting it.

### Effort & Cost
Reports how the work was actually produced, not how much the reviewed
*application's* LLM calls cost -- this is the coding agent's own session,
not a run of the product being built.

- **Tool** -- what ran the session (e.g. "Claude Code CLI", "Claude Code —
  VS Code extension", "Claude Code — web"). Read this from the session's own
  environment/system context, don't guess.
- **Model(s)** -- the exact model id(s) used (e.g. `claude-sonnet-5`),
  including any different model a spawned subagent ran under, if that
  differed from the main session.
- **Tokens** -- report input, output, and total token usage when available.
  Prefer a session-wide usage report such as Claude Code's `/cost` output or
  the IDE/extension's visible usage indicator. Add separately reported
  subagent usage only when the session-wide report explicitly excludes it.
  Never sum overlapping usage sources. If no complete usage source is
  available, report only the known values and clearly identify what they
  cover. If token usage is not available, write:
  "Token count not introspectable in this environment." Never estimate or
  invent token usage.
- **Cost (USD)** -- computed with the *same formula this project already
  uses* for LLM cost attribution (`server/src/platform/price-book.ts`'s
  `PriceBook.estimate` / `server/src/adapters/llm/pricing.ts`'s
  `estimateCost`): `(tokensIn * pricePerMTokIn + tokensOut *
  pricePerMTokOut) / 1_000_000`, with prices in USD per 1 million tokens for
  the specific model. Pull the *current* price for the model that ran this
  session from the `claude-api` skill/reference (the static
  `pricing.ts` table in this repo is for models the *product* reviews with,
  is explicitly marked approximate, and doesn't include this session's
  model) -- don't reuse a stale number. If the input/output split isn't
  known, report the total-token estimate and flag it as approximate rather
  than silently treating it as exact.
- **Human contribution** -- describe only the user contributions observable
  in the session: requirements, constraints, technical decisions, corrections,
  approvals, code supplied by the user, and manual verification performed by
  the user. Do not infer unobserved work or equate message count with effort.
  If the available transcript is insufficient, state that the contribution
  cannot be fully assessed.
- **Agent contribution** -- describe the work performed by the coding agent:
  investigation, implementation, tests, documentation, and automated
  verification. Distinguish autonomous work from work directed or corrected
  by the user.
- **Collaboration notes** -- identify the important points at which human input
  changed the implementation or prevented an incorrect result. Include only
  claims supported by the session transcript.

## Quality bar

- No filler, no restating the diff, no boilerplate ("This PR adds..." /
  "Changes include..." padding). Terse and factual, like a colleague
  handing off a finished task.
- Every claim must be verifiable by the reviewer from the diff, the named
  test run, or the session's own transcript -- not a paraphrase of what the
  ticket asked for, and never a fabricated number for tokens, cost, or a
  screenshot that wasn't actually captured.
- Prefer a bullet the reviewer will actually read over a paragraph they'll
  skim.
