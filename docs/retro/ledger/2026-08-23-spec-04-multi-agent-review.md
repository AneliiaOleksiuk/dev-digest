# Workflow Retro: spec-04-multi-agent-review
Date: 2026-08-23
Mode: default
Scope: SPEC-04 Multi-Agent Review end-to-end — spec-creator → implementation-planner → 4x implementer (G1–G4) → plan-verifier → fix-loop (2x implementer + test-writer) → plan-verifier (re-verify) → doc-writer → live smoke-testing with iterative direct fixes.

## Timeline

| # | Agent | Mode | Tokens | Tool uses | Duration | Round-trips |
|---|---|---|---|---|---|---|
| 1 | Explore — map existing multi-agent building blocks | background | 84,454 | 35 | 125.5s | 0 |
| 2 | spec-creator — draft spec | background | 145,437 | 49 | 302.0s | — |
|   | spec-creator — final (after 2 resumes) | background | 101,284 | 45 | 474.7s | 2 |
| 3 | Explore — verify diff-loader/intent-service caching | background | 37,750 | 12 | 62.8s | 0 |
| 4 | implementation-planner | background | 119,859 | 36 | 429.0s | 0 |
| 5 | implementer — G1 schema + contracts | background | **not observed** | **not observed** | **not observed** | 0 |
| 6 | implementer — G2 server orchestration | background | 301,218 | 107 | 1197.1s | 0 |
| 7 | implementer — G3 client UI | background | 310,581 | 185 | 1399.0s | 0 |
| 8 | implementer — G4 agent roster | background | 127,084 | 40 | 386.8s | 0 |
| 9 | plan-verifier — Phase 1+2, 1st pass (Sonnet override) | background | 189,843 | 66 | 647.6s | 0 |
| 10 | implementer — fix-loop: server + contracts | background | 229,185 | 106 | 845.2s | 0 |
| 11 | implementer — fix-loop: client | background | 132,766 | 61 | 455.2s | 0 |
| 12 | test-writer — fix-loop: targeted server tests | background | 214,156 | 69 | 744.9s | 0 |
| 13 | plan-verifier — re-verify, 2nd pass (Sonnet override) | background | 189,200 | 66 | 405.4s | 0 |
| 14 | doc-writer | background | 186,058 | 53 | 393.8s | 0 |

After doc-writer's PASS, every subsequent step (starting real dev server instances, fixing CORS/ports/API keys, diagnosing a silently-skipped migration, and 9 distinct bug fixes found via live screenshots) was direct main-agent tool use — **zero subagents spawned** for the rest of the session.

## Totals

Agent instances spawned: 14 (spec-creator counted once, resumed twice; every other agent completed in exactly one pass) · Total subagent tokens: **≥ 2,368,875** (G1's usage not captured — true total is higher) · Total tool uses: **≥ 930** (same gap) · Total round-trips: 2 (both on spec-creator) · Subagent-side wall-clock: **~7,869s (~131 min) summed**, but G2/G3/G4 ran concurrently (peak concurrency 3) and the fix-loop's client-fix + test-writer pair also ran concurrently, so actual elapsed wall-clock for those phases was roughly the *max*, not the sum — approximate real elapsed time across all 14 invocations is closer to **~95–105 min**, not 131.

## Insights

- G3 (client UI) self-reported building blind against an unverified contract: *"Endpoints were built against the plan's fixed names/shapes since G2's server side was running concurrently and hadn't landed when this work started — not yet integration-tested against a live server"* and *"No live browser click-through — G2/G4 hadn't landed yet, so nothing was running end-to-end to click through."* This predicted exactly the defect class that consumed the largest share of post-doc-writer fix time: three separate client/server shape mismatches (`GET /agents/stats` field names, `POST /pulls/:id/multi-agent-run`'s response shape, and the `conflicts[]` filtering semantics) were each found only via live testing with real credentials, not by G2, G3, or either plan-verifier pass.
- G1's task-notification is the only one of 14 in this session with no `<usage>` block — token/tool/duration cost for the single most foundational, blocking work item (the schema + contracts every other group built against) is unrecorded.
- Both plan-verifier passes caught real, distinct defect classes neither implementer nor doc-writer self-reported: missing test coverage across 4 modules despite the spec's own AC verify-clauses (pass 1), and — after the fix-loop — a genuinely dangerous migration ordering bug was *not* caught by either pass, because plan-verifier's own DB checks ran against the same already-populated shared database state that later caused the migration to silently no-op (see next bullet); it only surfaced once a *real* `pnpm db:migrate` was attempted live.
- Every one of the 9 defects found and fixed after doc-writer completed (CORS origin, wrong dev-server instance/port, missing LLM keys, a migration that silently no-op'd against a database holding later-timestamped rows from unrelated work, a response-shape bug that made the primary Run button do nothing, a truncated pre-existing i18n string, a missing findings list in Columns cards, uncolored/uncounted Tabs, and a header constrained to a stale 720px form width) was found exclusively through live screenshots from the user — none through any agent's own verification. This is the **second** entry in this repo's retro ledger to observe the same pattern: [`2026-08-15-pr-brief-submission.md`](2026-08-15-pr-brief-submission.md) found "two real defects... both invisible to the code-level verification audit and surfaced only once the running app was exercised live," and explicitly noted a green audit "was never a claim that generation works with the specific API credentials in use." This session adds: nor is it a claim the UI matches the design pixel-for-pixel.
- No agent was resumed more than spec-creator (2 round-trips, both driven by genuinely new information arriving mid-flight — 3 blocking questions, then design screenshots the user sent after the first resume was already in progress). Every implementer, both plan-verifier passes, and doc-writer completed in exactly one pass with zero round-trips, consistent with prompts that inlined the full plan/spec text rather than a bare file-path reference.
- Diagnosing the migration bug required reading `drizzle-orm`'s own compiled migrator source (`pg-core/dialect.js`) directly — the actual skip condition (`lastDbMigration.created_at < migration.folderMillis`) is not documented behavior a plan or spec could have anticipated; it was found by tracing runtime SQL/log evidence back through the library's own code, not by any written guidance.

## Recommendations

- Before splitting server and client work across parallel implementer agents building against the same not-yet-built API, either (a) land and freeze the exact wire format (field names, response shape) as a short, explicit contract stub both agents read verbatim, or (b) sequence the server work ahead of any client code whose primary action (here: the Run button) depends on that endpoint's response shape. G3's own report flagged this risk in advance; the plan didn't route around it, and it cost three separate live-only bug fixes.
- Capture `<usage>` on every agent completion, including ones whose final report is dominated by a Definition-of-Done checklist — G1 is the only gap in an otherwise-complete 14-invocation record.
- Before calling Phase 4 (Smoke) done, diff the actual rendered page against the design screenshots section-by-section (header layout/width, per-item color coding, counts/badges) in addition to functional click-through — this session's post-doc-writer fixes were almost entirely visual-fidelity gaps that a working-but-unstyled page would pass a "does it run" check while still failing.
- When a dev database is shared across worktrees/branches (this repo's course-environment norm — one fixed-name Postgres container), treat "the migration applied cleanly" as unverified until confirmed by a live query against that specific database, not just a green `pnpm db:migrate` exit code — this session's migration silently no-op'd once, then failed loudly once, before landing correctly on the third attempt, entirely due to unrelated state already on that shared instance.

