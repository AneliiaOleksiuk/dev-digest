# Workflow Retro: project-context-spec
Date: 2026-08-12
Mode: default
Scope: Drafting SPEC-01-project-context.md via the `spec-creator` agent —
one initial spawn plus two resumptions, covering the original design/
requirements brief, a set of blocking-question resolutions, and a later
gap-closing pass against a more detailed requirements text the user
supplied afterward.

## Timeline

| # | Agent | Mode | Model | Tokens (session total after this turn) | Tool uses (this turn) | Duration (this turn) | Round-trip? |
|---|---|---|---|---|---|---|---|
| 1 | spec-creator (spawn) | foreground | opus (persona default) | 105,525 | 35 | 413,894 ms (~6.9 min) | — (initial) |
| 2 | spec-creator (resume 1) | background, resumed via SendMessage | opus | 121,071 | 2 | 172,967 ms (~2.9 min) | yes — resolving 4 blocking product questions (merge semantics, specs_read vs. new field, folder scope, counters) |
| 3 | spec-creator (resume 2) | background, resumed via SendMessage | opus | 145,983 | 4 | 266,878 ms (~4.4 min) | yes — folding in 5 gaps found against a separate, more detailed requirements text the user supplied after the first draft |

Orchestrator-side (not billed to the subagent): ~10 Read/Grep/Glob/Bash
calls before the first spawn, used to front-load real `file:line` grounding
into the agent's prompt per this repo's context-handoff convention
(`agents/README.md`) instead of letting the agent re-derive it.

## Totals

Agents spawned: **1** (resumed twice → 3 turns) · Tool uses: **41** (35+2+4)
· Round-trips: **2** · Agent-side wall-clock: **~853,739 ms (~14.2 min)**
summed across the three turns.

The `subagent_tokens` figure climbs turn over turn (105,525 → 121,071 →
145,983) rather than resetting — **inferred, unconfirmed**: this reads as a
running total over the agent's growing conversation history (each resume
re-sends its own accumulated context), not a fresh per-turn count. Treat the
last value (145,983) as the agent's total lifetime token footprint this
session, not the sum of all three numbers — summing would double/triple
count. `tool_uses` and `duration_ms`, by contrast, reset each turn and look
like true per-turn deltas, so they were summed directly above.

## Insights

- The two round-trips were driven by genuinely new information arriving in
  stages from the user (first a design + requirements brief, then a
  separate, more detailed requirements text after the draft already
  existed) — not by the agent making a correctable mistake. Round-trip
  count here is a timing artifact of when information arrived, not a
  quality signal about the first brief.
- `spec-creator` self-reported one real tooling constraint: "AskUserQuestion
  isn't available inside a subagent, so the blocking questions are listed
  at the end of the report instead." It correctly fell back to listing
  questions in its chat report rather than guessing or silently proceeding.
- The orchestrator handed the agent one confident-but-wrong claim in the
  brief ("the trace's specs block currently does NOT render"). The agent's
  own self-check caught it and reported the correction: "Твоє припущення,
  що блок specs у трасі 'currently does NOT render' — невірне. Я перевірив
  сам." — this is the intended behavior per `agents/README.md`'s
  context-handoff rule ("each agent still forms its own independent
  judgment"), not wasted work.
- No agent-reported duplication of file reads occurred this run — expected,
  since only one agent instance existed across all three turns (nothing to
  duplicate against). The orchestrator's ~10 pre-spawn reads and the
  agent's own subsequent verification of some of the same files is
  **inferred overlap by design** (the agent's own hard constraints require
  it to independently verify every claim, even ones handed to it as
  grounding) — not observed as wasteful, since it caught a real error.
- All five Open Questions left in the final Spec (Q4, Q7, Q8, Q9, Q10) were
  deliberately deferred by the agent rather than guessed at — consistent
  with its own "no invented facts" self-check rule.

## Recommendations

- When briefing a subagent with orchestrator-derived conclusions (not raw
  file citations), flag inferential claims explicitly as "unverified —
  please confirm" rather than stating them as fact. The agent re-verifies
  regardless per its own rules, but a wrong confident claim risks biasing a
  less careful agent on a different persona.
- Keep `AskUserQuestion` calls at the orchestrator level, not delegated into
  the subagent, for any workflow shaped like this one (a spec/plan draft
  that needs mid-task product decisions) — confirmed necessary this run
  since the tool isn't available inside a subagent at all, and worked
  cleanly here.
- Continue writing exhaustive, literal text descriptions of design assets
  (screenshots) the subagent can't see directly — the current pattern
  produced a well-grounded first draft in one shot with no design-related
  correction needed.
- No process change needed for the round-trip count itself (see Insights),
  but when the user already has a full, detailed requirements text in hand,
  supplying it in the same message as the initial design brief — rather
  than after a first draft exists — would trade one round-trip for a longer
  first prompt. Minor timing optimization, not a fix for a defect.
