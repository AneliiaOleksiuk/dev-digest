---
name: workflow-retro
description: "Produces a retrospective on a multi-agent session that already happened in THIS conversation -- token/time spent per agent, spawn order, round-trips, friction the agents themselves reported, and concrete recommendations for next time. MANUAL ONLY -- invoke exclusively when the user explicitly runs /workflow-retro or asks for a retro/retrospective by name. Never invoke this proactively at the end of a workflow (sdd-build or any other multi-agent chain), even when it looks like a natural place to run it. Applies to any multi-agent session in this conversation, not just sdd-build's implementer->plan-verifier->doc-writer chain. Writes chat output plus a ledger file under docs/retro/ledger/."
---

# Workflow Retro

Retrospective on a multi-agent session that already ran in this
conversation: how many agents, in what order, at what token/time cost, how
much back-and-forth each one took, what friction they actually reported,
and -- not optional -- what to do differently next time.

## Trigger -- manual only

Run this skill **only** when the user explicitly invokes `/workflow-retro`
or asks for a retro/retrospective by name. Never run it proactively at the
end of `sdd-build` or any other multi-agent chain just because the chain
finished -- the user has said explicitly this stays manual for now. If a
future request asks to make it automatic, that is a change to this file,
not something to infer from context.

## Input

Optional arguments, in either order: `deep` to enable Deep mode (see
below); anything else is treated as a slug for the ledger filename. If no
slug is given, derive a short kebab-slug from the topic of the workflow
being retro'd (the Spec/Plan name, or a short description of what the
agents were doing).

If it's ambiguous which part of the conversation the retro should cover
(e.g. the session had two unrelated multi-agent stretches), ask the user
which one before gathering anything.

## What to gather -- in context (default)

Everything here comes from what is already visible in this conversation --
no extra reads, no extra agent calls:

- **Every agent spawn**: name/`subagent_type`, order, foreground vs
  background, model override if any, and what it was asked to do (one
  line).
- **Per-agent cost**: `subagent_tokens`, `tool_uses`, `duration_ms` from
  each Agent/SendMessage result's `<usage>` block. Report these as observed
  numbers, never estimated or rounded into a false precision.
- **Round-trips**: how many times each agent was resumed via `SendMessage`
  after its first run. This is the cheapest available proxy for "was the
  initial brief complete" -- an agent resumed twice means the first prompt
  was missing something the second one had to supply.
- **Self-reported friction**: anything an agent's own final report already
  said about its constraints or difficulty (e.g. "AskUserQuestion isn't
  available inside a subagent," "I re-verified X because the orchestrator's
  claim turned out wrong"). Quote or closely paraphrase these -- never
  invent a difficulty an agent didn't actually report.
- **Your own orchestration overhead**: how many times you (the main agent)
  had to re-read a file, re-grep, or re-derive something a subagent's
  report should have already covered -- this is duplication you can
  actually observe, unlike a subagent's internal tool calls, which you
  cannot see.

**What you genuinely cannot see by default**: a subagent's internal tool
calls (what it read, how many times, in what order). Do not claim to know
whether two subagents duplicated file reads unless one of them said so in
its report, or unless you are in Deep mode (below). If the ledger needs to
say "possible duplication," label it as inferred/unconfirmed, not observed.

## Deep mode (`deep` argument)

Opt-in only -- costs more, so only run it when asked. Two things Deep mode
adds, both bounded:

1. **Read the raw per-agent output file.** Each task-notification for a
   background agent includes an `<output-file>` path (a file under the
   harness's temp task directory). If it still exists on disk, `Read` it --
   it may hold more detail than what was summarized into the conversation.
   Skip silently (note the gap, don't fail) if the file is gone.
2. **One targeted follow-up per agent, at most.** For an agent still
   resumable by name, you may send **one** `SendMessage` asking a specific
   retro question its standard report contract doesn't cover (e.g. "what
   would have saved you a tool call if it had been in the original
   prompt?"). Never spawn a **new** agent instance just to gather retro
   data -- that inflates the exact cost this skill exists to measure. Cap
   at one follow-up per agent; if the answer doesn't fit in one message,
   move on rather than iterating.

Label every fact gathered this way as `[deep]` in the report, so a reader
comparing two retros (one default, one deep) knows which numbers are
comparable.

## Report shape (identical content in chat and in the ledger file)

```
# Workflow Retro: <slug>
Date: <YYYY-MM-DD>
Mode: default | deep
Scope: <one line -- what workflow/session this covers>

## Timeline
| # | Agent | Mode | Model | Tokens | Tool uses | Duration | Round-trips |
|---|---|---|---|---|---|---|---|
...

## Totals
Agents spawned: N · Total subagent tokens: N · Total round-trips: N ·
Wall-clock: ~Nm

## Insights
- <one atomic, self-contained bullet per insight -- same discipline as an
  INSIGHTS.md entry (`engineering-insights` skill): one claim, grounded in
  something actually observed, no narrative paragraph>
- ...

## Recommendations
- <concrete, actionable proposal for next time -- a prompt to inline
  upfront, a step to merge or drop, a question to front-load instead of
  round-tripping. Not optional -- always populate this section, even if
  the only finding is "this run was clean, nothing to change.">
- ...
```

Every `Insights` bullet must be traceable to something actually gathered
above (a `<usage>` number, a quoted self-report, an observed round-trip) --
same no-invented-claims discipline `spec-creator` applies to a Spec.
Distinguish "observed" from "[deep]" from "inferred, unconfirmed" inline
where it matters.

## Ledger

Write the same content to `docs/retro/ledger/<YYYY-MM-DD>-<slug>.md` -- one
file per retro run, the same one-file-per-instance convention this repo
already uses for `docs/adr/`, `docs/plans/`, and `specs/`, rather than one
ever-growing log file. Create `docs/retro/ledger/` if it doesn't exist yet.

When a retro's `Recommendations` reference a pattern seen before (e.g. "this
is the second time an agent got resumed for a merge-semantics question that
could have been asked upfront"), glob `docs/retro/ledger/*.md` for prior
retros on a related topic and cite them -- but only when you actually find
one, never claim a trend from a single data point.

## Rules

- Manual trigger only -- see Trigger above; do not soften this over time
  without an explicit request to do so.
- Never fabricate a metric. Missing data is reported as missing, not
  interpolated.
- Deep mode's one-follow-up-per-agent cap is a hard limit, not a
  suggestion -- re-spawning agents to investigate the workflow defeats the
  purpose of measuring it cheaply.
- `Recommendations` is mandatory in every report, not just when something
  went wrong.
- Write scope is `docs/retro/ledger/` only -- never edit the agents,
  specs, or plans this retro is reporting on.
