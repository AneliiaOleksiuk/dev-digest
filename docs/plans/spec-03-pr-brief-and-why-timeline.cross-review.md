# Cross-model review note — SPEC-03 plan

Plan reviewed: [`spec-03-pr-brief-and-why-timeline.md`](spec-03-pr-brief-and-why-timeline.md)
Reviewer: Cursor / Grok 4.6 High (different model family from the
Claude-based `implementation-planner` that authored the plan), 2026-08-14.
Scope: the plan's own 5 seeded scrutiny points, plus anything else the
reviewer found.

## Verdicts on the plan's 5 seeded scrutiny points

1. **Concurrent generation (cache-key race) — PLAUSIBLE CONCERN, accepted as-is.**
   Duplicate spend / one row / last-writer-wins is an acceptable failure mode
   for a local-first, single-process API (`reapStaleRuns()` already assumes
   this). No advisory lock needed for this iteration. Correction to the plan's
   own framing: the composite PK makes the *row* idempotent, not the *spend* —
   `inFlight` is the actual spend guard and it is single-process only. Should
   be restated next to WI7, not only in the appendix.
2. **Token-budget trim order vs. spec sub-cap — CONFIRMED ISSUE (narrow).**
   The "drop specs first" ordering itself is fine (it's AC-24, not a planner
   invention). The real defect: `MAX_SPEC_FILE_CHARS = 6_000` (read-time cap)
   is **below** what `SPEC_INPUT_TOKEN_SUBCAP = 2_500` tokens already admits
   (~10,000 chars), so a document that would fit the sub-cap gets silently
   truncated before the trim stage ever runs — contradicting WI5's own "no
   item survives partially" rule. **Fix: drop `MAX_SPEC_FILE_CHARS`, or raise
   it to ≥ the token sub-cap's char equivalent.**
3. **Why Timeline completeness — PLAUSIBLE CONCERN.** The accumulation
   trigger (stale banner → Generate) is real but weak — a typical PR yields a
   one-row timeline given D-8 (no auto-gen) + D-6 (no backfill). Not a plan
   defect to fix now; a coordinator call on whether WI12 ships this round or
   waits for a stronger trigger.
4. **Two-port split (`repository` + `sources`) — NO ISSUE.** The `Onboarding`
   comparison in the plan's own appendix was the wrong precedent (that's a DB
   reach, not an fs reach — `onboarding/facts.ts` is the real analog). Brief's
   `BriefSources` port is onion-correct for a new, non-exempt module.
5. **Shared `DiffViewer` — NO ISSUE.** AC-30/E-22 genuinely require jump-to-line
   in "original" order, and `DiffViewer` is the only place that can live.
   **One underspecified point:** unfocused files must keep
   `AUTO_EXPAND_MAX_LINES` behavior — this should be an optional focus overlay,
   not lifting every file card into controlled state.

## Additional problems found (not on the seeded list)

- **Linked-issue body has no owner.** AC-4/AC-24 stage 2 require linked-issue
  text as a model input, but `pr_intent.sources[]` only stores `{kind:
  'linked_issue', ref: '#N'}`, not the body, and `BriefSources` (WI3) has no
  GitHub fetch method. Stage 2 of the trim order is a no-op unless a work item
  adds the fetch (or the plan explicitly documents this input as always
  degraded/unresolved).
- **`failed` / `budget_exceeded` `BriefState` values are orphaned.** WI1 adds
  them to the enum; WI7's `getBrief` only ever produces
  `current/stale/absent/corrupt` (failed generations persist nothing, so
  there's no row to read them from); WI11 has no card UI for either. The
  NFR's "four distinguishable states" claim isn't actually wired end to end.
- **AC-7's verify clause is misleading as literally written.**
  `BlastService.getBlastRadius` internally calls `repoIntel.getBlastRadius` —
  WI7 correctly calls `BlastService` (per D-5) but "no repoIntel call" isn't
  true at the facade layer. `test-writer` should mock/spy `BlastService`
  itself, not assert zero `repoIntel` calls.
- **AC-15 ("open a specific older brief") is unspecified on the client.**
  WI7's timeline endpoint returns full `BriefRecord`s (server-side zero-call
  requirement met), but WI12 never states that clicking a timeline entry
  actually renders that historical brief's what/why/focus — only that the
  list itself renders.
- **WI9 cache-invalidation gap.** `useGeneratePrBrief` writes the brief query
  cache but never invalidates/updates the timeline query — a just-generated
  SHA won't appear in the timeline until a remount.
- **AC-38 (rate limit) is worse than the plan's own hedge admits.** Under
  `NODE_ENV=test` the rate-limit *plugin itself* is not registered
  (`app.ts`), so per-route `config.rateLimit` is a no-op regardless of test
  setup — "enable it inside the test" isn't sufficient; the test harness
  needs to actually register the plugin. This should be a required WI8/test-plan
  note, not filed as an optional gap.
- **WI7's `new BlastService(...)` inside `BriefService` leaks composition out
  of the container**, unlike the rest of the module's DI pattern. A container
  getter (or injecting the blast summary as a port) fits onion architecture
  better. Not a blocker, but easy to get wrong during implementation.
