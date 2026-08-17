# Plan Verification — SPEC-03 PR Brief & Why Timeline

Plan verified: [`spec-03-pr-brief-and-why-timeline.md`](spec-03-pr-brief-and-why-timeline.md)
Verifier: `plan-verifier` (Opus), run via the `run-plan` skill, Phase 3.
Commits covered: `be2e056` (Phase 1 Build), `8bfe36d` (Phase 2 Test),
`861e8b5` (fix-loop iteration 1).

Two runs are recorded below: the initial Phase 3 pass (`VERDICT: PASS WITH
REQUIRED FIXES`) and the re-verification after fix-loop iteration 1
(`VERDICT: PASS`). The fix-loop closed after one iteration of a possible
three.

---

## Run 1 — initial Phase 3 (evaluates `be2e056` + `8bfe36d`)

### Phase 1 — Traceability

| # | Plan item (verbatim) | Evidence (file:line / command output) | Verdict |
|---|---|---|---|
| 1 | WI1 — `git diff --no-index` on both vendored pairs exits 0; both packages typecheck; every `BriefState` value has a producer in WI7 and a render path in WI11 | `git diff --no-index server/…/brief.ts client/…/brief.ts` → exit 0; same for `review-api.ts` → exit 0. `BriefState` doc comment in `review-api.ts`. Producers: `service.ts:98,190,225,295,302` + `helpers.ts:97,98,104,109`. Render paths: `PrBriefCard.tsx:244,271,291,311,329` | MET |
| 2 | WI2 — composite PK + all new columns; `pnpm db:migrate` applies cleanly against live Postgres | `docker ps` healthy; `pnpm db:migrate` → applied; `\d pr_brief` shows all 13 columns and `pr_brief_pr_id_head_sha_pk PRIMARY KEY (pr_id, head_sha)` | MET |
| 3 | WI2 — `.sql` + `meta/_journal.json` + new `meta/NNNN_snapshot.json` all staged | `git show be2e056 --name-only` lists all three | MET |
| 4 | WI2 — "no file under `migrations/` hand-edited" | `0018_real_iceman.sql:1-8` carries a header stating manual completion of drizzle-kit's own incomplete output (unresolved PK-rename constraint name, wrong statement order). Applied result matches schema column-for-column | NOT MET |
| 5 | WI3 — constants, both ports, both adapters, DI + registry wiring; `arch:check` passes | `constants.ts`, `repository.ts` (no Drizzle import), `sources.ts`/`sources.node.ts` (containment guard, degrade-on-failure), `repository.drizzle.ts` (`scrubJson`), container + registry wiring. `pnpm arch:check` → 0 violations, 209 modules | MET |
| 6 | WI4 — every input block delimiter-wrapped; diff reaches prompt only as `IntentDiffSummary` | `prompt.ts` — every block through `wrapUntrusted`; spec path inside its block; `IntentDiffFileSummary` has no body field; injection guard present | MET |
| 7 | WI5 — sub-cap whole-document only; AC-24's 4 stages in order; `floorExceeded` produces no messages | `budget.ts` — floor check, whole-document sub-cap admission, 4 ordered stages, `dropped_inputs[]` per stage | MET |
| 8 | WI6 — mirrors `buildLineIndex` incl. empty-`newLineNumbers` fallback; drop-never-repair; empty is valid | `grounding.ts` — full-diff line index, risk kept with emptied refs, drop unknown/out-of-range, caps, no `node:fs` import | MET |
| 9 | WI7 — collaborators are the two ports only; one `completeStructured`; AC-16/12/13/25/42 behaviour | `service.ts` imports no adapter; `ConflictError` before work; reuse-without-force; `inFlight` dedupe; never classifies; blast only via port; one `completeStructured`; one catch → `failed`; upsert | MET |
| 10 | WI8 — three routes, `getContext` first, 404 on all three; AC-38 covered by a `nodeEnv:'production'` harness | `getContext` first statement in every handler; `brief.it.test.ts` asserts 404 cross-workspace on all three and 429 via the production harness | MET |
| 11 | WI8 — "routes appear in `routes-smoke.test.ts`'s surface" | Zero grep hits for "brief" in that file | **NOT MET** |
| 12 | WI9 — `onSuccess` sets cache + invalidates timeline, skipping timeline invalidation for transient states | `hooks/brief.ts:41,45-47` matches the plan's literal text (see row 19 for the cost this incurs elsewhere) | MET |
| 13 | WI10 — "every new key is referenced by a component" | 49 keys added, 0 redefined; `card.retry`, `generate.lastCost`, `timeline.toggle` referenced nowhere | **NOT MET** |
| 14 | WI11 — six distinguishable `BriefState` paths; gauge keeps deterministic source; no `dangerouslySetInnerHTML` | All six paths present; `VerdictBanner` gated on a completed review; prose as plain text | MET |
| 15 | WI11 — "transient states render in place over existing content, not replacing a good brief with an error" | Not implemented — `record` becomes `null` after a transient mutation via the shared cache key, closing every content/footer gate | **NOT MET** |
| 16 | WI12 — risk-change markers only on differing entries; disclosure string; historical-entry activation with zero new requests | `BriefTimeline.tsx` — lazy fetch, marker gated on `risk_changed`, activation from already-fetched payload, return path present | MET |
| 17 | WI13 — deep-link lands correctly in **both** smart and original order; unfocused `DiffViewer` files unchanged | Original order: MET (`DiffViewer.tsx` focus overlay). Smart order: fails for a collapsed role group | **NOT MET** |
| 18 | **Finding #1 (AC-30)** — deep-link into an initially-collapsed role group | Root cause confirmed independently: `SmartDiffViewer.tsx` only opens the file's own state, never `RoleGroup`'s private `groupOpen`. Test run: `FAIL … AC-30 (currently FAILING — implementation bug)` | **NOT MET** |
| 19 | **Finding #2 (WI11 in-place requirement)** — `onSuccess` overwrites the pr-brief cache | Confirmed independently, and the code comment claiming otherwise (`PrBriefCard.tsx:9-10`) is false. Traced consequence: a `failed` response nulls `record`, closing the Generate/Regenerate footer entirely | **NOT MET** |
| 20 | WI14 — Overview renders 3 panels; dangling focus entry non-navigating and self-explanatory | `OverviewTab.tsx` renders exactly 3 panels; disabled state + explanatory title when file not in `changedFilePaths` | MET |
| 21–28 | Test-plan commands (`typecheck`, `arch:check`, unit, integration ×2 packages, `db:migrate`) | `typecheck`/`arch:check`/`db:migrate` clean. Unit/integration/client suites each show a handful of failures, all traced to files untouched by either commit (`indexer-pipeline.test.ts`, `onboarding.it.test.ts`, `project-context-run.it.test.ts`, `SectionCard.test.tsx`) | Mixed — brief-scoped tests all MET; pre-existing failures NOT MET at the command level but attributed |

**Unplanned changes:** `server/INSIGHTS.md` (+100), `client/INSIGHTS.md` (+63) — session learnings, traceable to the plan's own Risks bullet. Nothing else outside Scope.

**Blockers:** `pnpm db:generate` not re-run directly (interactive, writes migration files; verified indirectly via committed artifacts + live schema instead).

### VERDICT (Run 1): PASS WITH REQUIRED FIXES

Required fixes, in application order:
1. Fix `SmartDiffViewer`'s `onJumpToLine` to open the enclosing `RoleGroup` before scrolling (row 18/17). Acceptance: the deliberately-failing test at `SmartDiffViewer.test.tsx` passes without being weakened.
2. Guard `hooks/brief.ts:41`'s `setQueryData` with the same state check already at `:45` (row 19/15); add an integrated-level regression test (real `QueryClient`); make the `PrBriefCard.tsx:9-10` comment true.
3. Reference `card.retry`, `generate.lastCost`, `timeline.toggle`, or remove them (row 13) — falls out of fix 2 naturally.
4. Add the three brief routes to `routes-smoke.test.ts`, or amend the plan's DoD (row 11).
5. No code fix required: record the pre-existing red tests in `BACKLOG.md`; note the migration hand-completion in `server/INSIGHTS.md`.

### Phase 2 — Architecture Review (Run 1)

`pnpm arch:check` → 0 violations, 209 modules, 737 dependencies. Findings beyond the deterministic tool:

| Severity | File:Line | Issue | Suggested direction |
|---|---|---|---|
| Major | `SmartDiffViewer.tsx` + `RoleGroup.tsx:42,82` | Per-file open state lifted to the parent; per-group open state stays private to the child, so no external actor can address a file inside a collapsed group. Same defect as row 18 | Lift group collapse into the parent as a `groupOpenMap` beside `openMap` |
| Major | `hooks/brief.ts:41` + `PrBriefCard.tsx:179,222-223` | A response state contractually never persisted is written into the cache representing persisted server state. Same defect as row 19 | Apply the `state` guard to `setQueryData` too |
| Minor | `repository.ts:7-8` + `helpers.ts:16-30` | Port re-exports the Drizzle-inferred row type; `helpers.ts` hand-duplicates it as a structural mirror to stay legal under `no-helpers-to-io` | Define the row DTO once as a plain interface; keep `$inferSelect` inside `repository.drizzle.ts` |
| Minor | `sources.node.ts:27-33` | Adapter re-queries pull/repo rows `service.ts` already holds, because the port's narrowed types don't satisfy `diff-loader`'s `PullRow` | Widen the port types, or accept as a documented tradeoff |
| Nit | `BriefTimeline.tsx:48` | Raw template-string count next to a translated label; the purpose-built `timeline.toggle` key sits unused | Use `t("timeline.toggle", { count })` |
| Nit | `.dependency-cruiser.cjs:15-71` | No `no-circular` rule, so the `container.ts` ↔ `sources.node.ts` composition-root cycle is structurally invisible (benign today via lazy getters) | Exempt deliberately if the rule is ever added |

---

## Fix-loop iteration 1 (commit `861e8b5`)

Assigned: `implementer` (both Major bugs + i18n wiring + bookkeeping), `test-writer`
(routes-smoke entry + integrated cache-regression test), a short follow-up
`test-writer` pass (fixing an ambiguous-text assertion in the now-passing
`SmartDiffViewer.test.tsx` AC-30 test — a test-authoring issue, not a code
issue, surfaced by `implementer`'s fix changing the test's failure mode from
"element not found" to "found multiple elements").

Summary of changes: `SmartDiffViewer.tsx`/`RoleGroup.tsx` (lifted `groupOpenMap`
into the parent, `onJumpToLine` opens both group and file before scrolling);
`hooks/brief.ts` (single guard covering both the cache write and timeline
invalidation); `PrBriefCard.tsx`/`BriefTimeline.tsx` (wired the three dead
i18n keys); `routes-smoke.test.ts` (+3 route-registration cases);
`hooks/brief.test.ts` (new — integrated cache regression test, real
`QueryClient`); `BACKLOG.md` / `server/INSIGHTS.md` / `client/INSIGHTS.md`
(bookkeeping).

---

## Run 2 — re-verification after fix-loop iteration 1 (evaluates `861e8b5`)

### Phase 1 — Traceability (delta + regression check)

| # | Item | Evidence | Verdict |
|---|---|---|---|
| R1 | Fix 1 — AC-30 / WI13 smart-order | `SmartDiffViewer.tsx:92-94,122-124,126-133` — `groupOpenMap` + `setGroupOpen`, `onJumpToLine` opens group and file. `RoleGroup.tsx:29-30,44-45,87` — collapse state now a controlled prop, mount still gated on it. `pnpm exec vitest run SmartDiffViewer` → 12/12 passed | MET |
| R1a | Is the reworked test assertion a strengthening, not a weakening? | Old: ambiguous `findByText("{}")` (two DOM matches). New: `data-diff-line` selector (same pattern as the sibling `ALREADY-OPEN-GROUP` test) + `scrollIntoView` assertion — strictly a superset, and independently falsified by the still-passing negative case (AC-31 safe no-op) | MET |
| R2 | Fix 2 — cache guard | `hooks/brief.ts:40-51` — early `return` above `setQueryData`, covering both writes | MET |
| R2a | Real-`QueryClient` regression test | `hooks/brief.test.ts` — genuine `QueryClient`, only `../api` mocked, `it.each` over `budget_exceeded`/`failed` asserting the cache is untouched, plus a control case proving a real `current` response still writes through. 3/3 passed | MET |
| R2b | Code comment now true | `PrBriefCard.tsx:6-10`'s claim verified true against `brief.ts:48`; the in-place render also structurally reads from `generate.data`, not the shared cache | MET |
| R3 | Fix 3 — dead i18n keys | `PrBriefCard.tsx:256,267`, `BriefTimeline.tsx:47` — all three now referenced; grep confirms no other hits | MET |
| R4 | Fix 4 — `routes-smoke.test.ts` | Three cases added in the file's existing no-DB pattern; part of the 37-passing server unit lane | MET |
| R5 | Fix 5a — `BACKLOG.md` | All four pre-existing failures recorded with counts matching independent re-measurement | MET |
| R6 | Fix 5b — `server/INSIGHTS.md` migration entry | Present since `be2e056`, confirmed still present, includes the "sanctioned completion of drizzle-kit's own flagged TODO" framing | MET |
| R7–R12 | Full test-plan command set, re-run fresh | `typecheck` (both packages) clean; `arch:check` 0 violations; server unit 319 passed/6 failed (`indexer-pipeline.test.ts` only); server integration 72 passed/8 failed (`onboarding.it.test.ts` only, Docker verified up); client 227 passed/1 failed (`SectionCard.test.tsx` only) | MET (all residual failures proved pre-existing — see below) |
| R13 | Regression check on WI11/WI12/WI13 client surface | `PrBriefCard.test.tsx` 16/16, `BriefTimeline.test.tsx` 7/7, `DiffViewer.test.tsx` 6/6, `SmartDiffViewer.test.tsx` 12/12 — no `.skip`/`.todo`/`.only` introduced anywhere in the brief surface | MET |
| R14 | Regression check on server side (only `routes-smoke.test.ts` touched) | `git show 861e8b5 --stat` confirms no other server path changed; WI1's byte-identical-mirror check re-run, still exit 0 | MET |
| R15 | AC-38 still covered | `brief.it.test.ts`'s `nodeEnv:'production'` harness still asserts 429; passes in the 9/9 isolated run | MET |

**Pre-existing-failure proof (not assumed, re-derived):** each of the four
residual failing test files was re-run against a detached worktree at
`34b2cb1` (the last commit before any SPEC-03 feature code) — failure count,
test names and assertion messages are identical at both commits, confirming
none of the three pipeline commits introduced or worsened them.

**Unplanned changes:** `client/INSIGHTS.md` (+67), `BACKLOG.md` (+29) —
session bookkeeping, both traceable to required-fix item 5 or the root
`AGENTS.md` end-of-session convention.

**Blockers:** none — every test-plan command executed to completion this run, integration lane included (Docker verified up first).

### VERDICT (Run 2): PASS

All five required fixes resolved against the code in `861e8b5`, each verified
independently from `git show`/file reads/command output. Fix-loop closes
after **1 of 3** possible iterations.

### Phase 2 — Architecture Review (re-assessed at `861e8b5`)

`pnpm arch:check` (fresh run) → 0 violations, 209 modules, 737 dependencies.

| Prior Major finding | Status | Evidence |
|---|---|---|
| `SmartDiffViewer`/`RoleGroup` split state ownership | **Resolved** | Collapse state now lives with the orchestrator (`SmartDiffViewer.tsx:92-94,122-124,132-133`); `RoleGroup.tsx:41-45` documents the inversion; existing manual-collapse/re-seed behaviour preserved |
| `hooks/brief.ts` cache/read-model corruption | **Resolved** | Single guard (`brief.ts:48`) covers both operations; the `BriefState` split it depends on is documented in the contract and re-stated as the test oracle |

Prior Nit (`BriefTimeline.tsx` raw concat) — **fixed** (`:47` now uses `t("timeline.toggle", {count})`).

New findings this round (non-blocking):

| Severity | File:Line | Issue | Suggested direction |
|---|---|---|---|
| Minor | `helpers.ts:16-30` (carried over, unchanged by `861e8b5`) | `BriefRow` structural mirror vs. `repository.ts`'s re-exported `PrBriefRow` — a future column addition compiles clean while `helpers.ts` silently narrows | Add a compile-time proof (`const _assert: BriefRow = {} as PrBriefRow`) in `brief-helpers.test.ts`, where importing `db/rows.ts` is legal |
| Minor | `sources.node.ts:27-33` (carried over, unchanged) | Extra DB round-trip per generation, caused by the port's narrowed types not satisfying `diff-loader`'s `PullRow`; in-file comment already justifies against LLM-call cost | No action required; defensible tradeoff |
| Nit | `PrBriefCard.tsx:251-257` (new in `861e8b5`) | Transient-outcome banner shows "nothing was charged" directly above `generate.lastCost` ("Last generation cost $X" — the *prior* brief's cost), which can read as contradictory on first pass | Move the cost line into the existing footer row, or reword to make the referent explicit ("Previous brief cost {cost}") |

No new Critical or Major finding. **No further fix-loop iteration required — the pipeline proceeds to `doc-writer`.**

### Verified clean (re-confirmed at `861e8b5`)

- Onion boundary rules on `service.ts`/`routes.ts`/`helpers.ts` — all pass.
- `sources.node.ts` remains the only fs/git/cross-module-service-construction file in the module; the composition leak the plan's cross-model review flagged (`new BlastService(...)`) stays in infrastructure, never in `service.ts`.
- Client layering — no direct `fetch`, no deep `vendor/ui` import, model-authored prose never via `dangerouslySetInnerHTML`.
- Both vendored contract pairs remain byte-identical.
