# Workflow Retro: spec-04-export-to-ci
Date: 2026-08-23
Mode: default
Scope: Full SPEC-04 "Export to CI" pipeline in this conversation — spec-creator, implementation-planner, five phase implementers (A–E), plan-verifier's first audit, a fix-loop implementer (iteration 1), plan-verifier's re-verification pass, and doc-writer. Excludes the human-driven manual QA that followed (real-repo Install test, live bug hunting, UI restyle) — those were direct tool use by the orchestrator, not agent delegation, per the same exclusion the pr-brief retro applied.

## Timeline

| # | Agent | Mode | Model | Tokens | Tool uses | Duration | Round-trips |
|---|---|---|---|---|---|---|---|
| 1 | spec-creator | background | default | 272,219 | 43 | 28m31s | 2 |
| 2 | implementation-planner | background | default | 187,925 | 45 | 12m58s | 0 |
| 3 | implementer (Phase A) | background | default | 178,198 | 78 | 13m42s | 0 |
| 4 | implementer (Phase B) | background | default | 214,788 | 99 | 17m33s | 0 |
| 5 | implementer (Phase C) | background | default | 334,434 | 149 | 30m13s | 0 |
| 6 | implementer (Phase D) | background | default | 297,129 | 141 | 23m27s | 0 |
| 7 | implementer (Phase E) | background | default | 161,207 | 101 | 11m25s | 0 |
| 8 | plan-verifier (first audit) | background | default | 237,724 | 67 | 12m04s | 0 |
| 9 | implementer (fix-loop iter. 1) | background | default | 227,149 | 120 | 16m34s | 0 |
| 10 | plan-verifier (re-verify) | background | default | 121,723 | 71 | 12m22s | 0 |
| 11 | doc-writer | background | default | 214,613 | 41 | 6m40s | 0 |

## Totals

Agents spawned: 11 · Total subagent tokens: 2,447,109 · Total round-trips: 2 · Wall-clock (sum of agent durations, mostly sequential): ~185m (~3h5m)

## Insights

- **The two round-trips (spec-creator) were driven by information arriving in stages, not a correctable flaw in the first brief** — a second batch of design screenshots, then a "keep this simple" mandate, both arrived from the user after spec-creator was already running. Same framing the 2026-08-12 retro used for an identical pattern: "Round-trip count here is a timing artifact of when information arrived, not a quality signal about the first brief." (See [2026-08-12-project-context-spec.md](2026-08-12-project-context-spec.md).)
- **plan-verifier's first audit found 1 Critical + 2 Major bugs across 82 acceptance criteria that six implementer phases had each individually reported as live-verified.** Every phase ran its own live check against the real server + Postgres, and every one passed — because each phase's live check tested only that phase's own code path in isolation. The Critical finding (the ingest endpoint's header contract never matched what the workflow generator actually emitted) lived exactly at the seam *between* two phases (B's generator and C's ingest route), which no single phase's isolated verification could see.
- **plan-verifier's own re-verification pass, run specifically to confirm the fix-loop's 3 fixes, found 3 new regressions the fix itself introduced** (a migration with no default/backfill, a spec-vs-code divergence on AC-51's literal wording, and a Preview/Install path-label mismatch) — none caught by the fix implementer's own live re-verification of the same three fixes. This is direct evidence for the fix-loop's 2-iteration cap: even a clean-looking fix needs a dedicated adversarial re-check pass, not just the fixer's own say-so.
- **Two more real defects surfaced only once a human tested against a real GitHub repo with a real, narrowly-scoped PAT — after all 11 agents and both plan-verifier passes had already run.** (1) Writing to `.github/workflows/*` requires GitHub's separate `workflow` OAuth scope, which the test PAT (`public_repo` only) lacked — invisible to every prior check because none of them ever attempted a real external write with a real, scope-limited credential; Phase C's "live verification" and both plan-verifier passes tested the *code path*, never GitHub's actual authorization boundary. (2) The workflow's reporting step lacked `continue-on-error`/`if: always()`, so an unreachable ingest URL (the default state for a local-first studio) would silently redden every real PR's check regardless of actual findings — a failure-mode-propagation bug across two interacting generated steps that plan-verifier's Phase 1 walk verified individually (permissions, forbidden events, pinned SHAs — each invariant checked in isolation) but never traced end-to-end.
- **This is the same pattern the pr-brief retro (2026-08-15) already recorded once**, almost verbatim: "Two real defects... were both invisible to the code-level verification audit and surfaced only once the running app was exercised live." Two sessions in a row, a clean multi-pass agent verification plus a human live-test each found *different* real bugs the agents' own checks missed. (See [2026-08-15-pr-brief-submission.md](2026-08-15-pr-brief-submission.md).)
- **doc-writer stayed inside its stated `docs/**`-only write scope without being told to, twice** — it declined to edit root `AGENTS.md`'s docs index (explicitly asked to consider it in the prompt) and instead returned a ready-to-apply diff for the orchestrator to place; the orchestrator applied it by hand. The scope boundary held on its own, not because it was enforced externally.
- **Phase C's implementer self-caught a real bug mid-build** (the `withRealBundle` gap — Install/zip were about to commit the Preview-only placeholder bytes instead of the real runner bundle) via its own live verification, before it ever reached a plan-verifier pass. Not every defect needed a downstream catch — this one didn't survive past the phase that introduced it.

## Recommendations

- **For any future `spec-creator` brief that depends on design screenshots, batch all of them into the initial spawn prompt** rather than sending them as follow-up messages once more arrive — in this session both spec-creator round-trips were images/directives already in hand before the agent was spawned, not new information genuinely discovered mid-run.
- **Add "trace failure-mode propagation across interacting generated steps" as an explicit, named check in `plan-verifier`'s Phase 1 method** for any feature that generates a multi-step artifact (a CI workflow, a pipeline config) — not just "verify each named invariant in isolation." This is the second time in this session alone (the Critical ingest-handshake finding, then the ingest-fault-tolerance bug found afterward by the orchestrator) that a bug lived in the *interaction* between two individually-correct steps rather than in either step itself.
- **Before treating a `plan-verifier` "PASS" (or "PASS WITH REQUIRED FIXES, now fixed") as feature-complete, run one real-world smoke test against the actual external system the feature integrates with, using a realistically-scoped credential** — not a superuser/admin credential, and not deferred entirely to post-ship manual QA. This is the third occurrence of the same root cause across two retros now (2026-08-15's OpenAI/Anthropic quota + stale-time bugs, this session's OAuth `workflow`-scope + ingest-fault-tolerance bugs): code-level and even live-app-level verification with an unconstrained test setup does not exercise the exact permission/network boundary a real user will hit.
- **Keep the 2-iteration fix-loop cap.** This session's data supports it directly: iteration 1 fixed all 3 findings cleanly per the re-verification pass's own live checks, and that pass's recommendation *not* to spend a second iteration on the remaining (non-code) items was itself a well-reasoned call, not a rubber stamp — the cap did not leave a real, fixable defect stranded.

Related prior retros: [2026-08-12-project-context-spec.md](2026-08-12-project-context-spec.md) · [2026-08-15-pr-brief-submission.md](2026-08-15-pr-brief-submission.md)
