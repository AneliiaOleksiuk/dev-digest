# Development Plan: L04 follow-ups — inline Blast tree, prior PRs, intent-hook rename, Smart-Diff severity jump, `verify:l03`

> **Decisions applied 2026-08-09** (user, course-lab feedback + a design-mock
> correction). Five follow-up items on branch `L04-MCP`. The two most
> load-bearing: (a) `BlastRadiusCard` must render the **full inline tree**, not
> the compact stat summary — this **supersedes**
> `docs/plans/l04-blast-radius-and-prepush-cli.md` **WI5**'s "compact
> summary … + a View blast radius affordance" decision, which is no longer in
> force; (b) "Prior PRs touching these files" is **net-new** work (nothing in
> the repo implements it today) and is built now, server + client.
>
> **All open questions are resolved** (user, 2026-08-09) — see Risks 1 and 2,
> both now RESOLVED. The Blast **tab is deleted** (WI11): once the Overview
> card renders the full tree, the 4th tab holds no unique logic. `prior_prs`
> is deliberately **not** exposed through MCP. Nothing in this plan is left
> for `implementer` to decide.

### Objective

Close five independent gaps found in the L04 lab review:

1. **Blast Radius on Overview is under-built vs. the mock.** The design mock
   renders the full interactive tree (symbol → callers → endpoint/cron badges,
   with a Tree/Graph toggle) *inline on the Overview tab*. Today the Overview
   card shows four stat tiles and a button that navigates away. Make the card
   render the real tree — and then **remove the now-redundant Blast tab**, so
   the PR page returns to three tabs and Blast lives in exactly one place.
2. **"Prior PRs touching these files" doesn't exist.** The mock shows a
   collapsible `Prior PRs touching these files [3]` row at the bottom of the
   Blast panel. Build it end to end: a `pr_files ⋈ pull_requests` overlap read,
   a contract field, and the collapsible UI.
3. **Intent hook names drifted from the course material.** Rename
   `usePrIntent` → `usePullIntent` and `useClassifyIntent` →
   `useRecalculateIntent` everywhere (rename, not alias).
4. **The file-header severity badge is invisible in Smart Diff mode**, so
   "click a severity on a file → land on the Findings tab with that finding's
   card open" is unreachable in the default diff view. Make the badge row
   render in both modes and finish the expand-on-arrival half of the link.
5. **There is no `verify:l03` self-check.** The course lab expects a single
   command that proves Lesson 03's deliverables (Intent layer · Smart Diff)
   still compile and pass their tests. Ship it as a root script.

Items 1 and 2 share files and ship together (Part A, with the tab removal as
Part E's tail). Items 3, 4 and 5 are unrelated to Blast and to each other, and
are independently shippable (Parts B, C and D).

### Scope

- **Packages/modules touched**
  - `server/` — `src/modules/blast/` gains a prior-PRs read (port +
    Drizzle adapter + cap constant + service/helpers wiring). One contract
    field added in the vendored `@devdigest/shared`, hand-mirrored to
    `client/`. No new module, no new route.
  - `client/` — a **new shared** `_components/BlastPanel/` (extracted from
    `BlastTab`), the Overview layout row, the **deletion** of
    `_components/BlastTab/` and its header tab entry; new `blast.json` keys;
    the two intent-hook renames in `lib/hooks/reviews.ts` + `IntentCard`; the
    `FileCard` severity-badge gate and the focus payload it emits.
  - `mcp/` — exactly **one test-fixture line** (see WI4). `mcp/src/**` is
    unchanged: `prior_prs` is intentionally not exposed through MCP
    (Risk 2, RESOLVED).
  - **NEW** `scripts/verify-l03.sh` (Part D) — root-level, matching the
    existing `scripts/*.sh` orchestration pattern.
  - Docs: `client/README.md`, `server/README.md`, root `README.md` +
    `TESTING.md` (WI10's usage line), `docs/features/intent-layer.md`,
    `docs/reference/intent-api.md` (hook names only, if it names them).
- **Explicitly out of scope**
  - **`repo-intel` and its pipeline.** Nothing here re-indexes, re-ranks, or
    changes symbol/reference extraction. The endpoint-detection depth limit
    documented by L04 WI4 stays exactly as it is — no traversal work.
  - **Any new migration or table.** `pull_requests` and `pr_files` already
    carry everything Item 2 needs (verified: `pr_files.pr_id` +
    `pr_files.path`; `pull_requests.id/repo_id/workspace_id/number/title/
    author`). See Risk 5 for the one *possible* index-only migration and how
    to produce it if the user asks for it (`pnpm db:generate`, never a
    hand-edited file under `server/src/db/migrations/**`).
  - **The 5 MCP tools' HTTP-only façade design**, the pre-push CLI, and
    `reviewer-core` — untouched by all five items (WI10 deliberately does not
    add a `reviewer-core` lane; see its own note).
  - `e2e/` — **no browser flow is added or removed** in this pass. Verified:
    no `e2e/` spec references `?tab=blast` or the Blast tab, so WI11's
    deletion breaks no browser test. Do not add one for the inline panel
    either, and `verify-l03.sh` never invokes Playwright.
  - The per-line severity popover in
    `client/src/components/diff-viewer/CodeLine/CodeLine.tsx` — verified this
    session to already work in both diff modes (its
    `onFocusFindings({ severity, findingId })` is **not** gated by
    `smartMode`). Item 4 is only about the **file-header aggregate** row.
  - Rewriting `docs/plans/intent-layer.md` / `docs/plans/smart-diff.md` /
    `docs/plans/l04-blast-radius-and-prepush-cli.md`, which describe the
    4-tab end state and the old hook names. Plans are a historical record of a
    decision at a date; they are not rewritten retroactively (WI8 and WI11
    list the doc surfaces that *are* in scope).
  - **A rubric/assertion-style L03 checker.** WI10 is a smoke gate
    ("everything compiles and the relevant tests are green"), not a per-file
    or per-endpoint conformance checker — explicit user decision, 2026-08-09.

### Constraints

**From root `AGENTS.md`**
- **`@devdigest/shared` is hand-copied**, not imported, into
  `server/src/vendor/shared` and `client/src/vendor/shared` — no sync script.
  WI4 edits one and hand-mirrors the other; that is the sanctioned route
  around the `*/src/vendor/**` do-not-touch entry, which means "no tooling
  generates this", not "never change it". Do **not** create a third vendor
  copy in `mcp/` — `mcp/tsconfig.json` already aliases the server's copy.
- **Do-not-touch:** `*/src/vendor/**` (hand-mirror, above) and
  `*/src/db/migrations/**` (regenerate with `pnpm db:generate`; this plan
  needs no migration — see Risk 5).
- **Migrations are never applied on boot.** Irrelevant here (no migration),
  but if Risk 5 is answered "add the index", `cd server && pnpm db:migrate`
  must be run manually afterwards.
- **Not a monorepo** — each package installs and tests independently; there is
  no root `package.json` and therefore no root command that runs all four
  suites. `./scripts/dev.sh` is the documented way cross-package orchestration
  is expressed here; WI10 follows that precedent rather than introducing a
  workspace root.

**From `server/AGENTS.md` + verified in code**
- Services depend on repository **interfaces**; `repository.ts` holds the port
  and plain types with **no Drizzle import**, `repository.drizzle.ts` holds the
  adapter. `server/src/modules/blast/repository.ts` already follows this
  exactly — WI3 extends it in place, it does not introduce a new pattern.
- Pure mapping lives in `helpers.ts` with no DB/adapter/container import (the
  onion `no-helpers-to-io` rule, enforced by `pnpm arch:check`);
  `server/src/modules/blast/helpers.ts` states this in its own docblock.
- Unit tests swap `ContainerOverrides` — `server/test/blast-service.test.ts`
  already builds a fake `BlastRepository` + fake `repoIntel`, so WI5 needs no
  DB.
- Documented split: unit = `pnpm exec vitest run --exclude '**/*.it.test.ts'`;
  integration = `pnpm exec vitest run .it.test`; `pnpm test` runs **both**.
  WI10 must use the unit form — `pnpm test` would drag in Docker-dependent
  integration tests.

**From `client/AGENTS.md`**
- All data fetching goes through `src/lib/hooks/*` — never an ad hoc `fetch`
  in a component. Item 2 adds **no new hook**: `prior_prs` rides on the
  existing `useBlastRadius(prId)` response.
- Feature logic lives in colocated `_components/<Name>/` folders with their own
  `*.test.tsx`; pages stay thin.
- Import UI **only** from the `@devdigest/ui` barrel; new reusable primitives
  go in `client/src/components/<name>/`, never `src/vendor/ui/**`.
- Commands are exactly `dev` · `build` · `start` · `typecheck` · `test`.

**Relevant `INSIGHTS.md` entries (cited)**
- `client/INSIGHTS.md` → Codebase Patterns, *"Single-consumer sub-components
  nest under their one parent's own `_components/`, not as a sibling
  top-level"*: this rule cuts **both ways** in this plan. WI1 puts the
  extracted panel top-level because it briefly has two consumers; WI11 deletes
  one of them, so the same rule requires nesting it under
  `BlastRadiusCard/_components/` as WI11's final step. Applying the rule in
  only one direction would leave a top-level shared component with a single
  consumer — exactly what the entry warns against.
- `client/INSIGHTS.md` → Tool & Library Notes, *"`gridTemplateColumns:
  repeat(auto-fit, minmax(<px>, 1fr))` is this codebase's way to get a '2
  columns on desktop, stacks under N px' layout"* and *"Don't nest
  `auto-fit`/`minmax(280px+)` inside a panel that already sits in a
  half-width Overview column"*: the inline tree cannot live in
  `intentBlastRow`'s ~400–500px column without the same overflow failure
  IntentCard already hit. WI2 gives Blast its own full-width row.
- `client/INSIGHTS.md` → *"`BlastRadiusCard` (Overview) went from 'always
  renders the unavailable placeholder' to a real `useBlastRadius`-backed
  compact summary … as of L04 WI5"*: this entry is **about to be superseded
  again** by WI2. Planner cannot edit it — see Risk 7 (ACTION).
- `client/INSIGHTS.md` → *"Overview has no Description panel … the mock is
  strictly three panels"*: still true for PR Brief / Intent / Blast; WI2
  changes only how the third panel is **laid out**, it does not add a fourth.
- `client/INSIGHTS.md` → *"`status !== 'full'` always renders a warning banner
  with the server's own `reason` — including `status === 'partial'`"*: the
  extracted `BlastPanel` must preserve this; the Overview card must not
  quietly drop the banner.
- `client/INSIGHTS.md` → *"A caller's `file:line` in Blast Radius links to the
  GitHub blob at the PR's head SHA … never into the diff viewer or through
  `focusFindings`"*: `BlastRadiusCard` therefore needs `repoFullName` +
  `headSha` threaded in (it has `headSha` available on `OverviewTab` already;
  `repoFullName` is not currently passed that far — WI2 threads it).
- `client/INSIGHTS.md` → *"New reusable UI primitives do NOT go in
  `src/vendor/ui/**` … `components/severity-badge-button/`
  (`SeverityBadgeButton` + `SeverityBadgeRow`)"*: WI9 reuses that existing
  primitive as-is; it adds no new primitive.
- `client/INSIGHTS.md` → *"PR-detail findings deep-link contract"* (the
  `?tab=&run=&severity=&finding=` URL state and the
  `FindingsTab → ReviewRunAccordion → FindingsPanel` threading): WI9's
  "expanded card" fix operates **inside** this existing contract — it changes
  what `FileCard` *emits*, not the URL vocabulary. WI11's unknown-tab
  normalization is the one deliberate addition to how `?tab=` is read.
- `client/INSIGHTS.md` → What Doesn't Work: *"`pnpm test run` is not 'run the
  tests'"* — run bare `pnpm test`. **WI10's script must not encode
  `pnpm test run`.**
- `server/INSIGHTS.md` → the seeded `acme/payments-api` has `clone_path: null`
  ⇒ empty diff and a permanently degraded blast; **not** a valid live smoke
  target for any of this.
- `server/INSIGHTS.md` → the vendored `trace.ts` copies have pre-existing
  comment drift — do **not** widen or "fix" it while mirroring
  `review-api.ts` in WI4.
- `server/INSIGHTS.md` → `test/indexer-pipeline.test.ts` has **6 known
  Windows-only flakes**. This is a hard design constraint on WI10: a gate that
  must exit 0 on a clean checkout cannot run the whole server suite.
- Root `INSIGHTS.md` → Tool notes: `pnpm <script>` can abort with
  `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` in this shell (call
  `./node_modules/.bin/<bin>` directly); Docker Desktop is not auto-started.
  Both facts are load-bearing for WI10.

**Corrections & supersessions (verified this session)**

- ⛔ **`docs/plans/l04-blast-radius-and-prepush-cli.md` WI5 is superseded**
  twice over. Its "replace the always-unavailable state with a *compact
  summary* (the four stat counts + a 'View blast radius' affordance switching
  to `?tab=blast`)" is **no longer the intended UX**, and its 4th **Blast
  tab** is **removed outright** (user, 2026-08-09; WI2 + WI11). The rest of
  WI5 — the honest degraded state, the pre-authored `blast.json` reuse, the
  top-level component placement — remains in force. **Nothing in this plan
  describes a 4-tab end state; the PR page ends at three tabs
  (Overview · Findings · Diff), with Blast living inside Overview.**
- ✅ `BlastRadiusCard.tsx` today renders four stat tiles via
  `computeStats(data)` (imported across folders from `../BlastTab/helpers`)
  plus a `Button … onClick={onViewBlast}`. It has **no** tree rendering.
- ✅ The full tree already exists, but only inside `BlastTab.tsx` as two
  non-exported local functions (`BlastBody`, `BlastTree`) plus `StatTile`,
  the view toggle in the `SectionLabel`'s `right` slot, and `BlastGraph.tsx`.
  None of it is currently reusable from another component — hence WI1. Once
  WI1 has moved it, `BlastTab` holds **no unique logic**, which is what makes
  WI11's deletion a deletion rather than a rewrite.
- ✅ `OverviewTab` renders `<IntentCard/>` and `<BlastRadiusCard/>` inside
  `s.intentBlastRow` = `repeat(auto-fit, minmax(380px, 1fr))`.
- ✅ **"Prior PRs" exists nowhere** — no route, no contract field, no i18n
  key, no component. Confirmed by grep across `server/src`, `client/src`,
  `mcp/src`, and `client/messages/en/*.json`.
- ✅ `client/messages/en/blast.json` has `stat.*`, `view.tree|graph`,
  `callerCount`, `noDownstream`, `graph.empty|ariaLabel`, `banner.*`,
  `depthNote` — **and nothing for prior PRs**. Reuse the existing keys
  verbatim (WI1 must not re-author them); author only the new
  `priorPrs.*` block (WI6).
- ✅ `BlastRepository` today exposes exactly `getPull` and `getPrFiles`;
  `DrizzleBlastRepository` implements both over `t.pullRequests` / `t.prFiles`.
  WI3 adds a third method to the same pair of files.
- ✅ `server/src/modules/blast/constants.ts` already holds the module's caps
  (`MAX_CHANGED_SYMBOLS_RENDERED`, `MAX_ENDPOINTS_LISTED`) with docblocks —
  `MAX_PRIOR_PRS` belongs there, mirroring
  `repo-intel/constants.ts`'s `MAX_CALLERS_PER_SYMBOL` convention.
- ✅ `pr_files` has **no index on `path`** (schema: PK only, plus the FK on
  `pr_id`). Relevant to Risk 5.
- ✅ `pull_requests.opened_at` / `updated_at` are **nullable**; `number` is
  `notNull` and unique per repo (`pr_repo_number_uq`). WI3's ordering is
  built on `number`, not on a nullable timestamp.
- ✅ `mcp/src/project.ts`'s `toBlastRadiusOutput` builds its DTO by explicitly
  naming fields, so **adding** a field to `BlastRadiusResponse` cannot break
  the MCP tool's output. It *will* break `mcp/test/fixtures.ts:145`
  (`makeBlastRadiusResponse` returns a `BlastRadiusResponse`) if the new field
  is required — a one-line fixture update, listed in WI4.
- ✅ Intent hooks: `usePrIntent` (`client/src/lib/hooks/reviews.ts:64`) and
  `useClassifyIntent` (`:74`). Fresh repo-wide grep this session found
  **exactly** these consumers: `reviews.ts` (declarations),
  `IntentCard.tsx:21,41,42`, `IntentCard.test.tsx` (16 lines: two `vi.fn()`
  handles, the `vi.mock` factory, two `mockReset`s, and 11
  `mockReturnValue` sites), plus **prose** mentions in `client/INSIGHTS.md:348-349`,
  `docs/features/intent-layer.md:167`, and two historical plan files
  (`docs/plans/intent-layer.md`, `docs/plans/smart-diff.md`). The barrel
  `client/src/lib/hooks/index.ts` re-exports `./reviews` **wholesale**
  (`export * from "./reviews"`) — no barrel edit is needed.
  `docs/reference/intent-api.md` does **not** name either hook. Nothing
  outside `client/` references either name.
- ✅ `FileCard.tsx:203` gates the header `SeverityBadgeRow` behind
  `!smartMode`, where `smartMode = fileSummary !== undefined`
  (`FileCard.tsx:125`). `RoleGroup.tsx` **always** passes `fileSummary`
  (a three-way fallback that is never `undefined`), and `DiffTab.tsx:35`
  defaults `order` to `"smart"` — so the badge row is invisible in the
  default diff view and visible only in the legacy `DiffViewer` path.
- ✅ **No INSIGHTS entry or code comment justifies the `!smartMode` gate.**
  Grepped `smartMode` and `SeverityBadgeRow` across the repo: the only hits
  are the three `FileCard.tsx` lines and the unrelated `client/INSIGHTS.md:72`
  entry about `SeverityBadgeRow` being a reusable primitive. Treat the gate as
  incidental, not deliberate.
- ❌ **The "expanded card" half of Item 4 is genuinely incomplete**, not just
  unreachable. Traced end to end: `FileCard` emits
  `onFocusFindings({ severity })` → `page.tsx`'s `focusFindings` sets
  `?tab=findings&severity=…&finding=` (cleared) → `FindingsTab` passes
  `focus` → `ReviewRunAccordion` computes `isTargetedSeverity` and **opens**
  the accordion → `FindingsPanel` applies `severityFilter` → but
  `FindingCard`'s `forceExpanded={finding.id === targetFindingId}` never fires
  because `targetFindingId` is `null` on a severity-only focus. So today the
  run opens and the list filters, and **every card stays collapsed**. WI9
  fixes both halves.
- ➕ **New: no `verify:*` script of any kind exists in this repo** — grepped
  every `package.json` (`server`, `client`, `reviewer-core`, `e2e`, `mcp`) and
  all of `scripts/`: **zero matches**. There is also no root `package.json` to
  hang one on. WI10 is therefore entirely new work, and the "command" is a
  root shell script, not an npm script (same shape as `devdigest review`,
  which is a CLI name fronted by `scripts/review.sh`).

### Work items

Suggested landing order: **WI10 first** (a clean-tree baseline, Risk 12), then
WI1–WI7, then WI8 and WI9 in any order, then **WI11 last** (it deletes files
WI1–WI7 still reference mid-plan).

---

#### Part A — Blast Radius (Items 1 + 2)

**WI1. Extract the tree/graph/banner rendering into a shared
`_components/BlastPanel/`.**
- This is the enabling refactor for Item 1's "share, don't duplicate"
  requirement, and it must land **before** WI2 and WI6 so neither writes tree
  markup twice.
- Files/modules:
  - **NEW** `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastPanel/`
    — `BlastPanel.tsx`, `BlastTree.tsx`, `BlastGraph.tsx` (moved),
    `helpers.ts` (moved), `styles.ts` (moved), `index.ts`. Top-level under the
    route's `_components/` **for the duration of this plan**, because it
    briefly has two consumers; WI11 nests it under `BlastRadiusCard/` once
    `BlastTab` is gone, per the same `client/INSIGHTS.md` placement rule.
  - `BlastPanel` owns everything currently inside `BlastTab.tsx`'s `BlastBody`:
    the `status !== 'full'` banner (with the server's `reason`), the four
    `StatTile`s, the `depthNote` line, the tree/graph switch, and the
    `noDownstream` empty state. It also owns the **Tree/Graph toggle control**
    itself (moved out of `BlastTab`'s `SectionLabel right` slot), because the
    mock shows the toggle inside the panel on Overview where there is no
    `SectionLabel`.
  - Props: `{ prId, repoFullName, headSha }` — `BlastPanel` calls
    `useBlastRadius(prId)` itself and owns its loading/error/`view` state, so
    both consumers stay thin and neither fetches. (The two consumers never
    render simultaneously and react-query dedupes the shared `["blast", prId]`
    key anyway, so this costs no extra request — and after WI11 there is only
    one consumer.)
  - `.../_components/BlastTab/BlastTab.tsx` — reduced to the `SectionLabel`
    header + `<BlastPanel …/>`. **Transitional:** WI11 deletes this folder
    outright. `BlastTab/helpers.ts`, `BlastTab/styles.ts`,
    `BlastTab/BlastGraph.tsx` are **deleted here** as part of the move (not
    left as duplicates).
  - `.../_components/BlastRadiusCard/BlastRadiusCard.tsx` — its cross-folder
    `import { computeStats } from "../BlastTab/helpers"` disappears in WI2;
    nothing may import from another sibling `_components/*` folder's internals
    afterwards.
- Behaviour must be **byte-identical** to today's `BlastTab` for a given
  response — this work item changes file layout only. In particular keep:
  the partial-status banner (`client/INSIGHTS.md`: partial warns, it does not
  hide), the `crons: null → "—"` unknown state, and `githubBlobUrl` (never
  `focusFindings`) for caller links.
- i18n: reuse `client/messages/en/blast.json` verbatim. **Author no new keys
  in this work item.**
- Applicable skills: `react-project-structure` (the new component folder + the
  move), `react-best-practices`, `typescript-expert`.
- Definition of done: `cd client && pnpm typecheck` clean; the **existing**
  `BlastTab.test.tsx` passes with only its import path adjusted and **no
  assertion weakened**; `grep -r "BlastTab/helpers\|BlastTab/styles\|BlastTab/BlastGraph" client/src`
  returns nothing.

**WI2. `BlastRadiusCard` renders the full inline tree; Overview gets a
full-width Blast row.**
- **Decision (user, 2026-08-09): supersedes L04 WI5's compact summary.** The
  Overview panel shows the same tree the mock shows — grouped by changed
  symbol (`rateLimit()` + `4 callers`), one `file:line` row per caller,
  endpoint badges (`GET /api/public/items`) and cron badges
  (`reset-rate-buckets (hourly)`), plus the Tree/Graph toggle — with no tab
  switch required.
- Files/modules:
  - `.../_components/BlastRadiusCard/BlastRadiusCard.tsx` — keeps the card
    chrome (bordered `s.wrap`, the `GitBranch` + `brief.block.blast` title
    that lives *inside* the card for mock parity) and the loading `Skeleton`;
    its body becomes `<BlastPanel prId repoFullName headSha />`. The local
    `CompactSummary` function and the `onViewBlast` `Button` are **removed**
    (the mock has no such button once the tree is inline).
  - `.../_components/BlastRadiusCard/styles.ts` — `statRow`/`statTile`/
    `statValue`/`statLabel` become dead once `CompactSummary` is gone; delete
    them rather than leaving unused style objects. `empty*` keys stay (the
    degraded fallback is still the card's own).
  - `.../_components/OverviewTab/OverviewTab.tsx` +
    `.../OverviewTab/styles.ts` — `BlastRadiusCard` moves **out** of
    `intentBlastRow` into its own full-width row below it. Rationale is a
    cited constraint, not taste: `client/INSIGHTS.md` records that nesting a
    `minmax(280px+)` grid inside `intentBlastRow`'s ~400–500px column already
    broke IntentCard's In|Out layout; a symbol tree with `file:line` monospace
    rows and endpoint badges is strictly wider than that. Keep
    `intentBlastRow` for `IntentCard` (it now sits alone in that row — either
    leave the grid as-is so it spans the width, or drop the wrapper; pick one
    and say which in the commit).
  - `.../page.tsx` — `repoFullName` is already computed at line 101 and must
    now be threaded `page.tsx → OverviewTab → BlastRadiusCard → BlastPanel`.
    With the button gone, the `onViewBlast` prop chain
    (`page.tsx` → `OverviewTab` → `BlastRadiusCard`) is **removed**. The
    `?tab=blast` route keeps working until WI11 removes it.
  - `.../_components/BlastRadiusCard/BlastRadiusCard.test.tsx` — its one
    existing case (degraded → honest "unavailable" empty state, never a
    fabricated tree) **must stay green**; add one case asserting a `full`
    response renders a symbol row + a caller `file:line` **inline**, i.e. with
    no click and no tab change.
  - The card's header docblock (which currently describes the compact summary
    and the `?tab=blast` affordance) must be rewritten, not left lying — the
    same rule L04 WI5 applied to the previous stale comment.
- `brief.json`'s `viewBlast` key becomes unused. Leave the message file
  untouched; note it in the session's INSIGHTS entry rather than pruning
  a translation file for one key.
- Applicable skills: `react-best-practices`, `react-project-structure`,
  `next-best-practices`, `typescript-expert`.
- Definition of done: on `?tab=overview`, a `full` blast response renders
  symbol groups, caller `file:line` links and endpoint/cron badges with **no
  navigation**; a `degraded` response still renders the honest unavailable
  copy; `cd client && pnpm typecheck` clean; `src/test/smoke.test.tsx` (the
  `/showcase` mount) still passes; `grep -rn "onViewBlast" client/src` returns
  nothing.

**WI3. Server — `prior PRs touching these files` read (port + Drizzle
adapter + cap).**
- Files/modules:
  - `server/src/modules/blast/repository.ts` — add a plain type and one port
    method (no Drizzle import, matching the file's existing docblock):
    ```ts
    export interface PriorPrRow {
      id: string;
      number: number;
      title: string;
      author: string;
      overlappingFiles: number;
    }

    getPriorPrsForFiles(
      workspaceId: string,
      repoId: string,
      excludePrId: string,
      paths: string[],
      limit: number,
    ): Promise<PriorPrRow[]>;
    ```
  - `server/src/modules/blast/repository.drizzle.ts` — the implementation:
    join `t.prFiles` → `t.pullRequests` on `pr_id`, filtered by
    `eq(workspaceId)`, `eq(repoId)`, `ne(t.pullRequests.id, excludePrId)` and
    `inArray(t.prFiles.path, paths)`; `groupBy` the four `pull_requests`
    columns with `count(distinct t.prFiles.path)` as `overlappingFiles`;
    `orderBy(desc(t.pullRequests.number))` then
    `desc(overlappingFiles)`; `limit(limit)`.
    **Order deliberately keys on `number`, not `opened_at`/`updated_at`** —
    those two columns are nullable in `pull_requests`, `number` is `notNull`
    and unique per repo (`pr_repo_number_uq`), so it is both a correct
    recency proxy and a deterministic sort. Guard `paths.length === 0` with an
    early `return []` — an empty `inArray` is a SQL foot-gun, and the service
    never reaches here with an empty list anyway (WI5).
  - `server/src/modules/blast/constants.ts` — `export const MAX_PRIOR_PRS = 5;`
    with a docblock in the same voice as the two existing caps, and
    `MAX_PATHS_FOR_PRIOR_PRS` (suggest 200) capping how many of the current
    PR's paths are sent into the `IN (…)` list, so a 900-file PR can't build a
    pathological query. Both are display/read-time caps, not behaviour
    switches.
- Applicable skills: `drizzle-orm-patterns` (the aggregate join),
  `onion-architecture` (the port/adapter split this extends),
  `postgresql-table-design` (only for reviewing the `path` predicate's cost —
  see Risk 5; **no schema change**), `typescript-expert`.
- Definition of done: `cd server && pnpm arch:check` passes (no Drizzle import
  leaks into `repository.ts`, no `db/client.ts` import from `service.ts`);
  `repository.ts` still has zero imports; the method returns `[]` (never
  throws) for a PR whose paths overlap nothing.

**WI4. `prior_prs` on the `BlastRadiusResponse` contract, in both vendored
copies.**
- Files/modules:
  - `server/src/vendor/shared/contracts/review-api.ts` — next to the existing
    `BlastRadiusResponse` declaration (same file, same section), add:
    ```ts
    export const PriorPr = z.object({
      id: z.string(),
      number: z.number().int(),
      title: z.string(),
      author: z.string(),
      overlapping_files: z.number().int(),
    });
    export type PriorPr = z.infer<typeof PriorPr>;
    ```
    and extend `BlastRadiusResponse` with `prior_prs: z.array(PriorPr)`.
  - `client/src/vendor/shared/contracts/review-api.ts` — **hand-mirror,
    byte-identical.** No sync script exists; a missed mirror is caught by
    nothing but `pnpm typecheck` on the client.
  - Check the vendored `index.ts` barrels re-export the new `PriorPr` symbol
    (they re-export `review-api` wholesale today — verify, don't assume).
- **`prior_prs` is required, not optional.** The service always produces it
  (`[]` on the degraded/no-files path), so an optional field would only add a
  `?.` at every read site for no honesty gain. The cost is exactly two fixture
  updates, both listed:
  - `mcp/test/fixtures.ts` (`makeBlastRadiusResponse`, ~line 145) — add
    `prior_prs: []`.
  - `client/src/app/.../BlastTab/BlastTab.test.tsx` (`FULL_RESPONSE`, typed as
    `BlastRadiusResponse`) — same. (That file is deleted by WI11; until then
    it must still compile.)
  `mcp/src/project.ts`'s `toBlastRadiusOutput` names its output fields
  explicitly, so the MCP tool itself keeps compiling untouched.
- **MCP DTO: `prior_prs` is intentionally not exposed through MCP** (user,
  2026-08-09 — Risk 2, RESOLVED). `mcp/src/schemas.ts` and
  `mcp/src/tools/get-blast-radius.ts` are **unchanged**: "which humans touched
  these files before" is a UI convenience, and `mcp/AGENTS.md`'s
  token-frugality principle argues against spending output tokens on it. Add
  one sentence to `toBlastRadiusOutput`'s docblock in `mcp/src/project.ts`
  recording the deliberate drop, matching how that file already documents its
  other dropped fields — a silently-missing field with no note is the failure
  mode to avoid.
- Do **not** touch the vendored `trace.ts` comment drift while in this
  directory (`server/INSIGHTS.md`).
- Applicable skills: `zod`, `typescript-expert`.
- Definition of done: the two `review-api.ts` copies are diff-clean against
  each other for this file; `cd server && pnpm typecheck`,
  `cd client && pnpm typecheck` and `cd mcp && npm run typecheck` all resolve
  the new field; `mcp/src/schemas.ts` and `mcp/src/tools/**` are untouched in
  the diff, and `project.ts`'s docblock says why.

**WI5. Wire prior PRs through the blast service.**
- Files/modules:
  - `server/src/modules/blast/service.ts` — after `getPrFiles`, add
    `getPriorPrsForFiles(workspaceId, pull.repoId, prId, files.slice(0, MAX_PATHS_FOR_PRIOR_PRS), MAX_PRIOR_PRS)`
    into the **existing** `Promise.all` alongside the two repo-intel facade
    calls (one extra round trip, run in parallel, not serially). The
    early-return `files.length === 0` degraded branch returns
    `prior_prs: []` — that path has no file paths to overlap on, so an empty
    list there is honest, not a silent failure.
  - `server/src/modules/blast/helpers.ts` — a small pure
    `mapPriorPrs(rows: PriorPrRow[]): PriorPr[]` (snake_case boundary
    conversion: `overlappingFiles` → `overlapping_files`). Keep it in
    `helpers.ts`, which is already the module's IO-free mapping layer.
  - **`summary` is deliberately unchanged.** The deterministic sentence
    describes the *impact map*; prior PRs are provenance, not blast radius.
    Do not append them to it.
- Applicable skills: `onion-architecture`, `typescript-expert`.
- Definition of done: `server/test/blast-service.test.ts`'s three existing
  `BlastRadiusResponse.parse(result)` assertions still pass; a new case with a
  fake repository returning two overlapping PRs asserts they surface as
  `prior_prs` in `number`-descending order with the right
  `overlapping_files`; a fourth asserts the empty-`pr_files` degraded branch
  returns `prior_prs: []`.

**WI6. Client — the collapsible "Prior PRs touching these files" section.**
- Files/modules:
  - `.../\_components/BlastPanel/PriorPrs.tsx` (+ styles in the panel's
    `styles.ts`) — a collapsible row rendered at the **bottom of the panel**,
    below the tree/graph, matching the mock: a chevron, the label, and a count
    badge (`[3]`). Collapsed by default. Each expanded row links to
    `/repos/${repoId}/pulls/${pr.number}` (an **internal** Next.js route —
    unlike caller `file:line` links, which go to github.com per
    `client/INSIGHTS.md`; these are DevDigest PRs we already have rows for)
    and shows `#number · title · author · N shared files`.
  - `BlastPanel.tsx` renders `<PriorPrs …/>`, so it is written exactly once
    regardless of how many consumers the panel has.
  - `repoId` must reach the panel for the href. It is available from
    `useParams` on `page.tsx`; thread it as a prop rather than calling
    `useParams` inside a leaf component.
  - **Render nothing** when `prior_prs` is empty — a collapsible row labelled
    `[0]` is noise. (Contrast with the blast tree itself, where an empty list
    *is* meaningful and gets `noDownstream`.)
  - `client/messages/en/blast.json` — author **only** the new keys, e.g.
    ```json
    "priorPrs": {
      "title": "Prior PRs touching these files",
      "sharedFiles": "{count} shared file(s)",
      "byAuthor": "by {author}"
    }
    ```
    Do not restate or duplicate `stat.*`, `view.*`, `callerCount`, or
    `depthNote` — they already exist.
- Applicable skills: `react-best-practices`, `react-project-structure`,
  `next-best-practices` (the internal `Link` target), `typescript-expert`.
- Definition of done: with two `prior_prs` entries the section renders
  collapsed with `[2]`, expands on click, and each row's href is
  `/repos/<repoId>/pulls/<number>`; with `prior_prs: []` nothing renders;
  `cd client && pnpm typecheck` clean.

**WI7. Tests + docs for Part A.**
- Files/modules:
  - `server/test/blast-service.test.ts` — the two new cases from WI5's DoD.
  - `client/src/app/.../\_components/BlastPanel/BlastPanel.test.tsx` — the
    moved-and-owned coverage, and the **only** home for it from here on:
    symbols/callers/endpoints render; the degraded **and** partial banners
    carry the server's own `reason`; a caller `file:line` is an anchor to the
    expected `githubBlobUrl`; the Tree/Graph toggle switches views;
    `prior_prs` renders collapsed with a count and expands.
  - `client/src/app/.../\_components/BlastTab/BlastTab.test.tsx` — **fold every
    assertion into `BlastPanel.test.tsx`** and leave this file as a bare
    "mounts the panel" check. Do **not** invest in polishing it: WI11 deletes
    it. Its only job between WI7 and WI11 is to keep compiling and stay green.
  - `client/src/app/.../\_components/BlastRadiusCard/BlastRadiusCard.test.tsx`
    — the existing degraded case + WI2's new inline-tree case.
  - `client/README.md` — the UI route map: Overview's Blast panel is now the
    full tree, not a summary-plus-link. (The tab-count line is WI11's edit —
    don't touch it twice.)
  - `server/README.md` — the `GET /pulls/:id/blast` entry now also returns
    prior PRs.
  - `server/src/modules/blast/README.md` if one exists (check;
    `server/src/modules/repo-intel/README.md` definitely does and needs **no**
    change — nothing here touches repo-intel).
- Applicable skills: `react-testing-library` (the client suites only — it
  does not apply to the server suite).
- Definition of done: every command in the Test plan is green (modulo the
  documented Windows flakes); no test file asserts the removed "View blast
  radius" button still exists.

---

#### Part B — Item 3 (independent of Part A)

**WI8. Rename `usePrIntent` → `usePullIntent`, `useClassifyIntent` →
`useRecalculateIntent`.**
- **Decision (user, 2026-08-09): a true rename, not an alias.** No
  back-compat re-export — a deprecated alias would leave both names greppable
  and defeat the point (matching the course material's vocabulary).
- Files/modules (the complete list from this session's fresh grep — re-run the
  grep before starting, but this is expected to be exhaustive):
  - `client/src/lib/hooks/reviews.ts:64,74` — the two `export function`
    declarations and their docblocks (the `useClassifyIntent` docblock says
    "Force re-classify"; keep the prose, change the name).
    **Do not change the react-query keys** (`["pr-intent", prId]`) or the
    endpoints — this is a symbol rename only, and the key is shared with the
    mutation's `invalidateQueries`.
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/IntentCard.tsx:21,41,42`
    — the import and the two call sites.
  - `.../IntentCard/IntentCard.test.tsx` — 16 lines: the two `vi.fn()` handles
    (`:14,15`), the `vi.mock("@/lib/hooks/reviews")` factory keys
    (`:18,19` — these are the **literal export names** and must match, or the
    mock silently stops intercepting), the two `mockReset`s (`:26,27`), and
    the 11 `mockReturnValue` call sites.
  - `client/src/lib/hooks/index.ts` — **verified: no edit needed**
    (`export * from "./reviews"` is wholesale). Confirm it stayed wholesale
    rather than assuming.
  - Prose surfaces that name the hooks and are current documentation (not
    historical plans): `client/INSIGHTS.md:348-349` and
    `docs/features/intent-layer.md:167`. (`docs/reference/intent-api.md` was
    checked this session and does **not** name them.)
  - **Do not** rewrite `docs/plans/intent-layer.md` or `docs/plans/smart-diff.md`
    — plans record a decision at a date.
- Applicable skills: `react-best-practices`, `typescript-expert`,
  `react-testing-library` (the `vi.mock` factory-key subtlety above).
- Definition of done: `grep -rn "usePrIntent\|useClassifyIntent" client/src`
  returns **nothing**; `cd client && pnpm typecheck` clean; every
  `IntentCard.test.tsx` case passes under the new names **with the same
  assertions** (a mock that stops intercepting produces a passing-looking
  render backed by a real hook — verify the suite still exercises the
  loading/error/stale branches, don't just check it's green).

---

#### Part C — Item 4 (independent of Parts A and B)

**WI9. Make the file-header severity badge reachable in Smart Diff mode, and
land on an expanded finding card.**
- **Two defects, one user-visible symptom.** Fix both; fixing only the first
  makes the badge clickable but still lands on a filtered list of collapsed
  cards.
- Files/modules:
  - `client/src/components/diff-viewer/FileCard/FileCard.tsx:203` — drop the
    `!smartMode &&` gate so the condition is
    `fileFindings.length > 0 && onFocusFindings`. **Before removing it,
    re-grep `client/INSIGHTS.md` for `smartMode`/`SeverityBadgeRow`** — this
    session found no recorded rationale (the only hit is the unrelated
    "reusable primitive" entry), but confirm nothing was added since.
  - Same file, header layout: in smart mode the row already contains the
    `summary` badge with `marginLeft: "auto"` (`:173`) and the `+/−` stat span
    (`:191`, which switches its own `marginLeft` on `showsBadge`). Adding a
    third right-aligned element needs a look at that `marginLeft: auto`
    juggling so the row doesn't wrap or push the path out — adjust the styles,
    don't just add the element and move on.
  - Same file, the emitted payload: change
    `onClick={(severity) => onFocusFindings({ severity })}` to also pass a
    `findingId` — the **first finding of that severity in this file**
    (`fileFindings.find(f => f.severity === severity)?.id`). That is what
    makes `FindingsPanel` set `forceExpanded` and `scrollIntoView`, closing
    the "з розгорнутою карткою" half of the ask. The severity stays in the
    payload so `ReviewRunAccordion.isTargetedSeverity` still opens the
    accordion and `FindingsPanel` still filters — verified this session that
    `isFiltered` gates `targetFindingId` forwarding, so **both** must be sent.
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/SmartDiffViewer.test.tsx`
    — the natural home for the regression test (it already mounts the
    Smart-Diff → `RoleGroup` → `FileCard` chain, which is exactly the path
    that was broken). Add: a file with findings renders the severity badge
    row in smart mode, and clicking it calls `onFocusFindings` with **both**
    `severity` and a `findingId` belonging to that file.
  - Optionally a first `client/src/components/diff-viewer/FileCard/FileCard.test.tsx`
    (the folder has none today) if the assertion is cleaner in isolation —
    `client/AGENTS.md`'s "each with its own `*.test.tsx`" makes this welcome,
    not scope creep.
- **Known limitation, deliberately not fixed here:** a severity click is still
  PR-wide, not file-scoped — `FocusFindingsOptions` is `{runId, severity,
  findingId}` with no `file`, and the URL vocabulary
  (`?tab=&run=&severity=&finding=`) is an established contract
  (`client/INSIGHTS.md`, "PR-detail findings deep-link contract"). Passing
  `findingId` lands the user on *this file's* finding, which satisfies the
  ask; adding a `file` param would widen the deep-link contract for every
  producer of it. See Risk 6.
- Applicable skills: `react-best-practices`, `react-testing-library`,
  `typescript-expert`.
- Definition of done: with `order = "smart"` (the default), a file with
  findings shows the CRITICAL/WARNING/SUGGESTION badge row in its header;
  clicking one navigates to `?tab=findings&severity=…&finding=…`, the run
  accordion opens, the list filters by that severity, **and the targeted
  finding's card is expanded and scrolled into view**; the legacy
  `DiffViewer` path is unchanged; `cd client && pnpm typecheck` clean.

---

#### Part D — Item 5 (independent of Parts A, B and C)

**WI10. `verify:l03` — a self-check gate for Lesson 03 (Intent layer · Smart
Diff).**
- **Decision (user, 2026-08-09):** scope is **typecheck + tests for the
  L03-touched areas in `client` and `server`** — a smoke gate ("everything
  compiles and the relevant tests are green"), **not** a bespoke rubric
  checker. No per-file or per-endpoint assertions, no schema check, no
  re-derivation of whether hooks are named correctly (WI8 owns that), and no
  Docker/integration lane.
- **Where it lives — and why it is a script, not an npm script.** There is no
  root `package.json` ("not a monorepo", root `AGENTS.md`), and no `verify:*`
  script exists in any package (verified this session: zero matches across all
  five `package.json` files and `scripts/`). The established pattern for
  cross-package orchestration here is a root `scripts/*.sh` —
  `dev.sh`, `e2e.sh`, `mcp-on.sh`, `mcp-off.sh`, `review.sh`. Follow it:
  the lab's `verify:l03` **name** is preserved in the docs and in the script's
  `--help` text, while the invocation is `./scripts/verify-l03.sh` — exactly
  the precedent `devdigest review` set (a CLI name fronted by
  `scripts/review.sh`).
- Files/modules:
  - **NEW** `scripts/verify-l03.sh` — structure copied from the existing
    scripts, not invented: `#!/usr/bin/env bash`, the `#`-comment usage block
    at the top, `set -euo pipefail`, the
    `ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$ROOT"`
    preamble, and `dev.sh`'s `log()`/`warn()` colour helpers
    (`printf '\033[1;36m▸ %s\033[0m\n'`). A `-h|--help` branch that
    `sed`s the header block, same as `dev.sh`.
  - Root `README.md` — one usage line. This is the better fit than
    `AGENTS.md`: `README.md` already documents `./scripts/dev.sh` (twice, at
    the quick start and in troubleshooting) and already carries the lesson
    table that names `L03 | Intent layer · Smart Diff`, so the command lands
    next to the thing it verifies.
  - `TESTING.md` — one cross-reference line under "Running locally", since a
    reader looking for "how do I check L03" will look there first. Do not
    duplicate the whole usage block in both files.
- **What the script runs, in order (fail fast, `set -e`):**
  1. `server` typecheck — `tsc --noEmit -p tsconfig.json`.
  2. `server` **narrowed** unit tests — vitest with positional filename
     filters for the L03 suites **plus** `--exclude '**/*.it.test.ts'`:
     `intent-` and `smart-diff-`, i.e. `server/test/intent-inputs.test.ts`,
     `intent-service.test.ts`, `smart-diff-classifier.test.ts`,
     `smart-diff-service.test.ts`. Narrowing is not an optimisation — it is
     what makes the gate trustworthy: `server/test/indexer-pipeline.test.ts`
     has 6 known Windows-only flakes (`server/INSIGHTS.md`), so a
     whole-suite gate would fail on a clean checkout on this machine. The
     `--exclude` keeps `server/test/reviews.it.test.ts` (which L03 also
     touched) out, because it needs Docker.
  3. `client` typecheck — `tsc --noEmit`. Package-wide by construction; `tsc`
     has no honest "just these folders" mode here.
  4. `client` tests — the **full** suite, `vitest run`. Verified this
     session: `client/vitest.config.ts` has a single
     `include: ["src/**/*.test.{ts,tsx}"]` and `package.json` exposes only
     `test: "vitest run"` — there is **no** narrow per-folder script, and no
     tag/project split to key off. The client suite is jsdom-only and needs no
     Docker, so running all of it is cheap; say so in a comment rather than
     inventing a fragile path filter over `IntentCard`/`SmartDiffViewer`/
     `DiffTab`/`diff-viewer`, which would silently stop covering L03 code the
     moment a file moves (WI1, WI2 and WI11 in this very plan move and delete
     files).
- **Invoke the local binaries directly** — `(cd server && ./node_modules/.bin/tsc …)`,
  `(cd client && ./node_modules/.bin/vitest run)` — rather than
  `pnpm typecheck` / `pnpm exec vitest`. Root `INSIGHTS.md` documents
  `pnpm <script>` aborting with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`
  in this non-interactive shell; a gate script is *always* non-interactive, so
  side-stepping pnpm's runner by construction is the right call, not a
  workaround bolted on after the first failure. Record that reasoning in a
  comment so nobody "simplifies" it back to `pnpm test`. Relatedly: never
  write `pnpm test run` (`client/INSIGHTS.md`), and never `cd server && pnpm test`
  (that runs unit **and** integration per `server/AGENTS.md`).
- Guard on missing installs: if `server/node_modules` or `client/node_modules`
  is absent, fail with the actionable message (`cd server && pnpm install`)
  rather than a confusing `command not found` — `dev.sh`'s
  `install_if_needed` is the shape to borrow, but **do not install anything**;
  a verify gate must not mutate the working tree.
- **Output contract:** one `log` line per lane, then a short per-package
  pass/fail summary at the end. Exit **non-zero** on any failure (typecheck or
  test) so it is usable as a pre-submission gate; exit 0 only when all four
  lanes pass.
- **Deliberately excluded: `reviewer-core`.** L03 also touched
  `reviewer-core/src/prompt.ts`, `src/review/run.ts` and added
  `reviewer-core/test/prompt-intent.test.ts` (confirmed in commit `97fa7e8`),
  so a third lane would be defensible. The user scoped this to `client` +
  `server`, so it stays out — but say so in the script's header comment rather
  than leaving a future reader to wonder whether it was overlooked. Adding the
  lane later is three lines (`cd reviewer-core && ./node_modules/.bin/vitest run`,
  npm-installed, not pnpm).
- Applicable skills: none (shell orchestration + docs; no skill in
  `.claude/skills/` covers bash scripting, and `typescript-expert` does not
  apply to a file that contains no TypeScript).
- Definition of done: `./scripts/verify-l03.sh` runs from the repo root **with
  Docker stopped** and exits **0** on a clean checkout; deliberately breaking
  one L03 file (e.g. a type error in
  `server/src/modules/smart-diff/service.ts`) makes it exit non-zero with the
  failing lane named; `./scripts/verify-l03.sh --help` prints the usage block;
  the script never writes to the working tree (no install, no build output,
  no `.env` creation); root `README.md` documents the one-line usage next to
  the lesson table, and `TESTING.md` cross-references it.

---

#### Part E — Blast tab removal (Item 1's tail; lands after WI7)

**WI11. Delete the Blast tab; the PR page returns to three tabs.**
- **Decision (user, 2026-08-09): option (b) — delete.** Not keep-both, not a
  redirect. Once WI2 puts the full tree on Overview, `BlastTab` is a
  `SectionLabel` wrapper around `BlastPanel` with **no unique logic**, and a
  second surface for identical data is a maintenance liability, not a feature.
- **Sequencing: land this LAST, after WI7.** WI1–WI7 still import and test
  `BlastTab`; deleting it earlier breaks the tree mid-plan. It is placed at
  the end of this document for exactly that reason, despite belonging to
  Item 1.
- Files/modules:
  - `.../_components/PrDetailHeader/PrDetailHeader.tsx` — remove the 4th
    `tabs` entry (`{ key: "blast", label: "Blast", icon: "GitBranch" }`),
    added by L04 WI5.
  - `.../page.tsx` — remove the `{tab === "blast" && <BlastTab … />}` branch
    and the `import { BlastTab }` line.
  - `.../_components/BlastTab/` — **delete the whole folder**
    (`BlastTab.tsx`, `BlastTab.test.tsx`, `index.ts`). By this point WI1 has
    already moved `helpers.ts`, `styles.ts` and `BlastGraph.tsx` out, and WI7
    has folded the remaining assertions into `BlastPanel.test.tsx`, so nothing
    of value is lost. Verify that with a grep before deleting, don't assume it.
  - `.../_components/BlastPanel/` → **move to**
    `.../_components/BlastRadiusCard/_components/BlastPanel/`. `BlastPanel`
    now has exactly one consumer, and `client/INSIGHTS.md`'s placement rule
    ("single-consumer sub-components nest under their one parent's own
    `_components/`") is the same rule WI1 cited to justify putting it
    top-level while it had two. Apply it in both directions or the codebase
    contradicts its own documented convention. This is a folder move plus
    import-path updates in `BlastRadiusCard.tsx` and `BlastPanel.test.tsx` —
    **no logic change** — and it must land in the same commit as the deletion
    so the inconsistent intermediate state never reaches `main`.
  - `client/README.md` — the UI route map line that lists a 4th tab. The PR
    page is Overview · Findings · Diff again.
- **Incoming `?tab=blast` URLs — decided, not left to chance: normalize
  unknown tabs to `overview`.** In `page.tsx`, read the raw param and fall
  back when it isn't one of the three known keys:
  ```ts
  const KNOWN_TABS = new Set(["overview", "findings", "diff"]);
  const rawTab = search.get("tab") ?? "overview";
  const tab = KNOWN_TABS.has(rawTab) ? rawTab : "overview";
  ```
  Rationale, over the two alternatives: leaving it a **dead param** renders
  the header with a blank content area (no branch matches `"blast"`), which
  looks like a broken page; an explicit **`router.replace` redirect** adds a
  navigation side effect on mount for a URL almost nobody holds. Normalization
  is one line, has no side effect, sends every stale `?tab=blast` bookmark to
  the tab that now *contains* the blast tree, and fixes typo'd `?tab=` values
  as a bonus. It reads the deep-link contract more defensively without
  changing its vocabulary.
- Applicable skills: `react-project-structure` (the folder move and the
  placement rule), `react-best-practices`, `next-best-practices` (the
  query-param normalization), `typescript-expert`.
- Definition of done: the PR page header shows **three** tabs;
  `grep -rn "BlastTab\|tab=blast\|\"blast\"" client/src` returns only the
  normalization's `KNOWN_TABS` set and unrelated `blast.json`/`useBlastRadius`
  references — no component, no import, no tab key; visiting
  `/repos/:repoId/pulls/:number?tab=blast` renders the **Overview** tab with
  the Blast panel visible and no console error; `BlastPanel` lives under
  `BlastRadiusCard/_components/`; `cd client && pnpm typecheck` and
  `cd client && pnpm test` are both clean; `client/README.md` no longer
  mentions a Blast tab.

### Test plan

Commands taken from each package's own `AGENTS.md` / `TESTING.md` — not
invented:

```sh
# server (WI3, WI4, WI5, WI7)
cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'   # unit, no Docker
cd server && pnpm typecheck
cd server && pnpm arch:check                                    # WI3's port/adapter boundary

# client (WI1, WI2, WI4, WI6, WI7, WI8, WI9, WI11)
cd client && pnpm test          # bare `test` — NEVER `pnpm test run` (client/INSIGHTS.md)
cd client && pnpm typecheck

# mcp (WI4 — one fixture line; mcp/src/** is unchanged)
cd mcp && npm run typecheck
cd mcp && npm test

# the new gate itself (WI10) — must be green before and after the rest of this plan
./scripts/verify-l03.sh
```

`reviewer-core` and `e2e` are untouched by all five items — no run needed.
Server **integration** tests (`pnpm exec vitest run .it.test`) are optional
here: WI3's new query is exercised by a fake repository in the unit suite, and
the integration lane needs Docker.

Notes for whoever runs these:
- `pnpm <script>` can abort with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`
  in this Windows shell (root `INSIGHTS.md`). Fall back to
  `./node_modules/.bin/vitest.cmd run --exclude '**/*.it.test.ts'` and
  `./node_modules/.bin/tsc.cmd --noEmit -p tsconfig.json`. WI10's script
  avoids this by calling the local binaries directly from the start.
- `cd server && pnpm typecheck` **should be clean** — the old "3 pre-existing
  errors in `orders.ts`" caveat was fixed on 2026-08-08 via
  `"exclude": ["src/modules/orders/**"]` in `server/tsconfig.json`. Any
  typecheck error you see is yours.
- `server/test/indexer-pipeline.test.ts` has **6 known Windows-only flakes**
  (`server/INSIGHTS.md`). Check `git status` on that file before treating a
  failure there as a regression. Nothing in this plan touches the indexer, and
  WI10's narrowed filter keeps that file out of the gate entirely.
- Docker Desktop is **not auto-started** here (root `INSIGHTS.md`). Check
  `docker ps` before claiming any live check; if it's down, say so rather than
  implying a live verification happened. `./scripts/verify-l03.sh` is designed
  to pass with Docker stopped — if it ever needs Docker, WI10's premise has
  failed.
- **Live verification of the inline Blast panel needs a repo that is actually
  cloned and indexed.** Do **not** use the seeded `acme/payments-api` — its
  `clone_path` is `null`, so `pr_files` is empty and PR #482's diff is always
  empty; blast will be permanently `degraded` and you will be looking at the
  fallback state, not the tree. The devDigest repo itself is the known-good
  target; confirm `GET /repos/:id/index-state` says `full` or `partial` first.
- **Prior PRs need a repo with ≥2 imported PRs whose `pr_files` are
  populated.** `pr_files` is only written once `GET /pulls/:id` has run for
  that PR (documented in `smart-diff/service.ts`), so open each candidate PR's
  detail page once before expecting the section to appear.
- Item 4's live check is one click: open a PR's Diff tab (default = Smart),
  click a severity badge on a file header, confirm you land on Findings with
  that card **open**.
- WI11's live check is two: the header shows three tabs, and a stale
  `?tab=blast` URL lands on Overview with the Blast panel rendered (not a
  blank content area).

### Risks / Open questions

**No OPEN items remain** — both were resolved by the user on 2026-08-09.
Items marked **RESOLVED** carry a user decision: implement them as written, do
not re-open. **ACTION** items are for the session-end `engineering-insights`
pass. **INFO** items are context a reviewer will otherwise re-derive.

1. **RESOLVED — delete the Blast tab.** (User, 2026-08-09, choosing option
   (b) over keep-both and over a redirect.) After WI2, `BlastTab` and
   `BlastRadiusCard` render the same `BlastPanel` from the same data, and
   `BlastTab` contributes only a `SectionLabel` and a URL. **WI11** removes
   the 4th `PrDetailHeader` entry, the `{tab === "blast"}` branch, and the
   `_components/BlastTab/` folder, then nests `BlastPanel` under
   `BlastRadiusCard/` (its now-single consumer, per the placement rule WI1
   cited in the other direction). Stale `?tab=blast` links are handled by
   normalizing unknown tab keys to `overview` — a one-line, side-effect-free
   read guard, chosen over a dead param (blank content area) and over a
   `router.replace` redirect (navigation side effect on mount). WI11 lands
   **after WI7** so nothing references deleted files mid-plan.
2. **RESOLVED — `prior_prs` is omitted from the MCP `get_blast_radius` DTO.**
   (User, 2026-08-09, confirming WI4's recommendation.) `mcp/src/schemas.ts`
   and `mcp/src/tools/get-blast-radius.ts` are unchanged; the only `mcp/` edit
   in this plan is the `prior_prs: []` line in `mcp/test/fixtures.ts` that the
   required contract field forces. Rationale: `mcp/AGENTS.md`'s
   token-frugality principle, and "which humans touched these files before" is
   a UI affordance rather than something a reviewing model acts on — it
   already receives the symbol/caller/endpoint map, which is the load-bearing
   part. WI4 requires one sentence in `toBlastRadiusOutput`'s docblock
   recording the deliberate drop, so the omission is documented rather than
   silent.
3. **RESOLVED — `BlastRadiusCard` shows the full inline tree, superseding L04
   WI5.** (User, 2026-08-09, choosing the "Recommended" option.) The mock is
   authoritative: symbol groups, caller `file:line` rows, endpoint/cron
   badges, Tree/Graph toggle, all on Overview with no tab switch. The
   tree-rendering logic is extracted **once** into `BlastPanel` (WI1) and must
   not be duplicated.
4. **RESOLVED — "Prior PRs touching these files" is built now.** (User,
   2026-08-09.) Verified feasible with **no migration**: the overlap is
   `pr_files.path` ⋈ `pull_requests`, both of which already exist and are
   already populated by the PR-detail sync.
5. **INFO (act only if it bites) — `pr_files` has no index on `path`.**
   WI3's query filters `pr_files.path IN (…)` and joins to
   `pull_requests`; the table's only index today is the PK (schema verified).
   At this app's local-first scale (one workspace, tens of repos) a sequential
   scan is fine, and `MAX_PATHS_FOR_PRIOR_PRS` bounds the `IN` list. If it
   ever shows up as slow, the fix is a **generated** migration
   (`cd server && pnpm db:generate`, then `pnpm db:migrate`) adding an index
   on `(pr_id, path)` or `(path)` — **never** a hand-edited file under
   `server/src/db/migrations/**`. Don't add it pre-emptively in this pass.
6. **INFO — the severity deep-link stays PR-wide, not file-scoped (WI9).**
   Clicking CRITICAL on `src/a.ts` filters *all* runs' CRITICAL findings, not
   just that file's. WI9 mitigates the symptom by also passing a `findingId`
   from that file, so the user lands on the right card — but the filtered list
   around it still spans the PR. Fixing it properly means adding a `file` key
   to `FocusFindingsOptions` and a `?file=` URL param, which widens a contract
   with four existing producers (PR-list hover preview, Timeline, run-header
   badges, diff lines). **Deliberately deferred**; record the limitation in
   `client/INSIGHTS.md` at session end.
7. **ACTION — `client/INSIGHTS.md`'s `BlastRadiusCard` entry will be stale the
   moment WI2 lands** (planner cannot edit it). The entry beginning
   *"`BlastRadiusCard` (Overview) went from 'always renders the unavailable
   placeholder' to a real `useBlastRadius`-backed compact summary … (four
   stat tiles + a 'View blast radius' button that flips `?tab=blast`)"* — note
   it already supersedes an even older 2026-08-07 entry, so this is the
   **third** state of the same component. Correct it at session end rather
   than appending a fourth entry that leaves a reader guessing which is
   current. Two neighbouring entries need the same pass: the layout one
   (*"reserve `auto-fit`/`minmax` for the outer Intent|Blast row only"* — Blast
   leaves that row in WI2) and anything describing the PR page as having four
   tabs (WI11 takes it back to three).
8. **ACTION — `client/INSIGHTS.md:348-349` and `docs/features/intent-layer.md:167`
   name the old intent hooks** and become wrong when WI8 lands. Update both at
   session end (`engineering-insights` skill). Historical plan files are
   deliberately left alone.
9. **INFO — the `vi.mock` factory keys in `IntentCard.test.tsx` are the
   silent failure mode of WI8.** `vi.mock("@/lib/hooks/reviews", () => ({
   usePrIntent: …, useClassifyIntent: … }))` intercepts by **literal export
   name**. Rename the module's exports without renaming these keys and the
   mock stops matching — the component then calls the *real* hooks, and
   several tests may still appear to pass (rendering a loading state) while
   asserting nothing meaningful. WI8's Definition of done requires confirming
   the loading/error/stale branches are still genuinely exercised, not just
   that the suite is green.
10. **INFO — two components mount `useBlastRadius` only transiently.** Between
    WI2 and WI11 both `BlastRadiusCard` (Overview) and `BlastTab`
    (`?tab=blast`) call the hook. They never render simultaneously (the tab
    switch is exclusive) and react-query dedupes the shared `["blast", prId]`
    key regardless, so it was never a double-fetch — and WI11 removes the
    second consumer entirely. Called out only so a reviewer doesn't file it as
    a bug during the window in which it exists.
11. **INFO — vendor-mirror edit (WI4).** Editing
    `server/src/vendor/shared/contracts/review-api.ts` and hand-copying to
    `client/` is the repo's documented convention with direct precedent
    (`BlastRadiusResponse` itself, `SmartDiffResponse`, `PrIntentRecord`).
    Flagged anyway because `*/src/vendor/**` reads as "do-not-touch" at a
    glance and **no tooling catches a missed mirror** — only
    `cd client && pnpm typecheck` will.
12. **INFO — WI10's gate and this plan's own work items overlap.**
    `./scripts/verify-l03.sh` runs the **full** client suite, which includes
    the tests WI1/WI2/WI6/WI8/WI9/WI11 rewrite or delete. Land WI10 either
    first (so it is a genuine before/after baseline) or last (so it is written
    against the final file layout) — but don't interleave it, or a red gate
    will be ambiguous between "L03 regressed" and "Part A is mid-refactor".
    **Recommendation: land WI10 first**, on a clean tree, so its exit-0 claim
    is verified against code nobody has touched yet.

### Explicitly out of scope

Architecture review and security review are owned by separate agents — see
`agents/README.md`#handoff-chain.
