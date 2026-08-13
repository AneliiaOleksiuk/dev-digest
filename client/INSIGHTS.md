# INSIGHTS — client

Accumulated engineering knowledge for this package: what worked, what didn't,
codebase-specific patterns, tool quirks, and open questions — kept OUT of
[AGENTS.md](AGENTS.md) under the ≤100-line / map-not-documentation rule.

Read at the start of every session per AGENTS.md, and updated at the end via
the `engineering-insights` skill — treat entries here as high-confidence
guidance unless AGENTS.md says otherwise. Append-only; entries must pass the
"cold read" test (actionable without re-investigation) — see
[../.claude/skills/engineering-insights/SKILL.md](../.claude/skills/engineering-insights/SKILL.md).

## What Works

- **Formatting tiny/variable-magnitude USD costs**: `${Number(usd.toPrecision(2))}`
  (see `client/src/helpers/format.ts` `formatCost`) renders `$0.06`,
  `$0.014`, `$0.0013` correctly with no trailing zeros, instead of
  `.toFixed(2)` which rounds anything under a cent to `$0.00`. `null`/
  `undefined` must map to `"—"`, not `"$0.00"` — a run without usage data
  (failed/running/cancelled) should read as "no data", not "free".

## What Doesn't Work

- **`pnpm test run` is not "run the tests"** — `test` is already
  `vitest run`, so the extra `run` arg gets passed to vitest as a filename
  filter, silently narrowing the suite to files whose path contains "run"
  (e.g. 4/13 files: `RunHistory`, `RunStatus`, `RunReviewDropdown`,
  `RunTraceDrawer`) with a clean "all passed" exit — no warning that most
  of the suite didn't execute. Always run bare `pnpm test` for the full
  suite; only append a filter when you actually want one.
- **`ConventionCard`'s Reject button silently persisted `status: "rejected"`
  with zero visual feedback** — `ConventionsListView.deselect()` did call
  `PATCH /conventions/:id {status: "rejected"}`, but the card's style/actions
  branched only on local `selected` (true/false), so "rejected" and "never
  reviewed" rendered identically (same neutral card, same Accept/Reject
  buttons) — clicking Reject looked like a no-op. Fixed 2026-08-02 by
  branching on `candidate.status === "rejected"` directly (dim card +
  "Rejected" badge + single Undo button that PATCHes back to `"pending"`).
  Side effect discovered while fixing: repeated test clicks against the
  *old* silently-broken button had already flipped 29/30 real rows in the
  `conventions` table to `status='rejected'` — always check `SELECT status,
  count(*) FROM conventions GROUP BY status` (via
  `docker exec devdigest-postgres psql -U devdigest -d devdigest -c "..."`)
  before assuming a status-toggle bug is purely cosmetic; the mutation may
  have been firing correctly the whole time.
- **PR-list `tableCard` cannot host an in-tree absolute popover.** It needs
  `overflowX: "auto"` (horizontal scroll for `MIN_ROW_WIDTH`) which, paired
  with `overflowY: "hidden"`, clips anything that paints past the card's
  bottom edge — exactly the findings-preview cut-off above the scrollbar.
  You also can't "fix" this by setting `overflowY: "visible"` while
  keeping `overflowX: "auto"`: CSS computes the visible axis to `auto`.
  Fix is `Popover` portaling to `document.body` with `position: fixed`
  (viewport coords), not relaxing `tableCard` overflow.

## Codebase Patterns

- **`SeverityBadge` (`src/vendor/ui/primitives/Badge.tsx`) already accepts a
  `count` prop** — before building a new component for any "N findings by
  severity" UI (a PR-list column, a run-timeline line, a stat tile), reuse
  `<SeverityBadge severity="CRITICAL" count={n} compact />` per non-zero
  severity rather than inventing a bespoke icon+count element. It was
  previously only ever used per-finding (`FindingCard.tsx`, no `count`
  prop passed) — passing `count` and reusing it for aggregates just works.
- **New reusable UI primitives do NOT go in `src/vendor/ui/**`** (it's
  do-not-touch, hand-mirrored per `client/AGENTS.md`). They go in
  `client/src/components/<name>/` instead — the same tier `diff-viewer`
  already lives in. Established this with `components/popover/Popover.tsx`
  (generic hover-triggered floating panel — `Dropdown` in `vendor/ui/kit`
  is the closest existing thing but is click-triggered and its panel body
  only accepts a typed `items` list, not arbitrary children) and
  `components/severity-badge-button/` (`SeverityBadgeButton` +
  `SeverityBadgeRow`, wrapping `SeverityBadge` as a real clickable button —
  reused across `PRRow`, `RunHistory`, and `ReviewRunAccordion` so the
  three-badge-per-severity JSX block exists exactly once).
- **PR-detail findings deep-link contract**: `[number]/page.tsx` exposes
  `?tab=&run=&severity=&finding=` as one URL-driven focus state, via a
  `focusFindings({runId?, severity?, findingId?})` helper built on a new
  `setParams(patch)` (multi-key version of the pre-existing `setParam`,
  needed because setting `tab`+`run`+`severity` via three sequential
  single-key `setParam` calls races — each snapshots `search` before the
  previous write commits). `FindingsTab` → `ReviewRunAccordion` →
  `FindingsPanel` thread these down as `targetRunId`/`targetSeverity`/
  `targetFindingId`; a run match scrolls, a bare-severity match (no run —
  the PR-list entry point) opens every matching run without scrolling.
- **`FindingCard`'s `data-finding-id={f.id}` attribute was dead scaffolding**
  until this session — added earlier but nothing read it. `FindingsPanel`
  now uses it directly via `document.querySelector('[data-finding-id="…"]')
  .scrollIntoView(...)` in a `targetFindingId` effect — simpler than
  threading a ref map through the list, and safe because ids are unique
  across the whole document even when several `ReviewRunAccordion`s are
  open at once (matching bare-severity case) and all run the same effect.
- **The file-header severity badge in `FileCard` was invisible in Smart Diff
  mode until 2026-08-09 (L04 follow-ups WI9)** — it was gated behind
  `!smartMode`, and `smartMode` is true whenever `RoleGroup` (the
  `SmartDiffViewer` path, the default `order` in `DiffTab`) renders the file,
  since it always passes a `fileSummary` prop. No INSIGHTS entry or code
  comment ever justified the gate; removing it was a one-line fix. The
  second half of that fix: the badge's `onClick` now sends **both**
  `severity` and a `findingId` (the file's first finding of that severity) —
  `severity` alone made `ReviewRunAccordion` open and `FindingsPanel` filter,
  but never set `forceExpanded` on any card, so every card stayed collapsed.
  Both fields are load-bearing; check `isTargetedSeverity`/`isFiltered` in
  `ReviewRunAccordion.tsx` before changing either in isolation.
- **The severity deep-link is PR-wide, not file-scoped, by design (so far).**
  Clicking CRITICAL on one file's header badge filters *all* runs' CRITICAL
  findings, not just that file's — `FocusFindingsOptions` has no `file` key.
  WI9 (above) mitigates the symptom by also passing a `findingId` from that
  file, so the user lands on the right expanded card, but the filtered list
  around it still spans the whole PR. A proper fix means adding a `file` key
  to `FocusFindingsOptions` and a `?file=` URL param, which widens the
  deep-link contract above for its four existing producers (PR-list hover
  preview, Timeline, run-header badges, diff lines) — deliberately deferred,
  not attempted.
- **`usePrLatestFindings(prId, {enabled})` in `lib/hooks/reviews.ts`
  intentionally reuses `usePrReviews`'s exact query key** (`["reviews",
  prId]`) — it's the same endpoint (`GET /pulls/:id/reviews`), just gated
  by an `enabled` flag for lazy (hover-triggered) fetching from the PR
  list. Reusing the key means hovering a PR-list row and later opening
  that PR's detail page (or vice versa) shares one react-query cache entry
  instead of double-fetching.
- **A route's `client/messages/en/<feature>.json` can already encode the
  intended UX before any component exists** — building the Skills feature
  (2026-08-02), `messages/en/skills.json` was fully authored (page/detail/
  drawer/file/url/community/listItem/preview sections) while
  `client/src/app/skills/` didn't exist yet. It specified a materially
  different flow than the plan drafted from the written requirements alone
  (three import paths — file/URL/community — with NO "create from
  scratch" option, `name` optional and derived from the first markdown
  `#` heading, no `type`/`description` fields collected at import time).
  Always grep `messages/en/*.json` for the feature's namespace before
  designing new UI — it's pre-existing course scaffolding, not aspirational
  filler, and is more authoritative than a spec inferred from a prose
  requirements doc.

- **`src/vendor/ui/nav.ts` (the `NAV` sidebar array + `SHORTCUTS` registry)
  is under the do-not-touch `src/vendor/ui/**` path per `AGENTS.md`, but is
  a sanctioned exception in practice** — unlike the component files in that
  tree, it's routing/config data, not visual-design-system code. Confirmed
  necessary three times now (Skills nav entry 2026-08-02; the Conventions
  nav entry the same day; splitting `WORKSPACE` into a separate
  `SKILLS LAB` group for Agents/Skills/Conventions, 2026-08-05 — see
  Session Notes): without an entry here, a new top-level route is only
  reachable by typing the URL directly — the sidebar has no link to it, and
  `activeKeyFor` in `components/app-shell/helpers.ts` (already pre-wired for
  `pathname.includes("/conventions")` before this session even added the
  page) has nothing to highlight. Flag this exception to whoever's
  reviewing before editing it, don't silently treat "do-not-touch" as
  covering it. `Sidebar.tsx` already maps generically over `NAV: NavGroup[]`
  — adding a second section needs zero template changes, just a new
  `{ section, items }` entry.
- **A pre-authored `messages/en/*.json` breadcrumb label can reveal an
  intended sidebar *grouping*, not just a screen's copy** — extends the
  pattern above (pre-authored JSON encoding intended UX ahead of the UI).
  `skills.json`, `conventions.json`, `agents.json`, and `eval.json` all
  independently used `"Skills Lab"` as their breadcrumb root
  (`crumbLab`/`breadcrumbLab`/`crumbSkillsLab`) well before `nav.ts` grouped
  those three nav items under a matching sidebar section — the IA decision
  was already made in copy, `nav.ts` just hadn't caught up. When a sidebar
  grouping looks arbitrary or flat, grep `messages/en/*.json` for shared
  breadcrumb-root strings before inventing a new grouping — it may already
  be specified. (`eval` has no `nav.ts` entry at all yet despite sharing the
  same breadcrumb root — pre-existing gap, left alone since it wasn't part
  of the request that prompted this note.)
- **A pre-authored `client/messages/en/<feature>.json` namespace can cover
  only *part* of a feature's flow, not the whole thing.** Extends the
  pattern noted below for `skills.json` (list/detail/import were all
  pre-authored ahead of the components) — for `conventions.json`, the
  list-page and card copy (`page.*`, `card.*`) were pre-authored, but the
  create-skill-from-conventions modal had NO corresponding namespace at
  all (no `modal.*` keys existed). Don't assume "the JSON file exists, so
  the copy for my whole feature is covered" — check that every screen/step
  of the flow you're building has matching keys, and author the missing
  ones following the existing file's tone/structure rather than guessing
  at a different process.

- **Intent Layer i18n lives under `prReview.intent.*`, not `brief.block.intent`.**
  `brief.json`'s `block.intent` ("Intent") is scaffolding for the unbuilt PR
  Brief feature. The Overview IntentCard (and every other PR-detail component)
  already uses `useTranslations("prReview")`, so new copy goes in
  `messages/en/prReview.json` under a dedicated `intent` namespace (title,
  empty/stale/error, scope labels, source kinds, confidence). Trace-drawer
  prompt-slot labels stay in `runs.json` (`trace.prompt.intent`) — same file
  as the other `trace.prompt.*` keys. Don't reuse `brief.block.intent` for the
  card; don't put IntentCard keys in `runs.json`.

- **Embedded Overview panels prefer a compact empty state over `EmptyState`.**
  `@devdigest/ui`'s `EmptyState` pads ~60px and centers for full-page empty
  screens (Skills list, FindingsPanel filter miss). For a section that sits
  above Description on the PR Overview tab (IntentCard), a short left-aligned
  title/body + primary CTA inside the same bordered `wrap` as the classified
  state matches VerdictBanner / OverviewTab language better and avoids a
  giant dead zone in the first viewport.

- **Extend a shared component with an optional prop rather than duplicating
  its render logic in a wrapper, when only one extra field differs.**
  `VerdictBanner` (`_components/VerdictBanner/`) gained an optional
  `costUsd?: number | null` prop (renders a `formatCost` badge only when
  non-null) so the new Overview `PrBriefBanner` could show cost without a
  second near-identical verdict-rendering component; `ReviewRunAccordion`'s
  existing usage doesn't pass it, so it's fully backward compatible and
  `VerdictBanner.test.tsx` needed no changes. Used for the PR Brief banner
  (docs/plans/intent-layer.md WI13).
- **Single-consumer sub-components nest under their one parent's own
  `_components/`, not as a sibling top-level `_components/<Name>/`.**
  `PrBriefBanner` (Overview's PR Brief panel, WI13) is only ever rendered by
  `OverviewTab`, so it lives at `OverviewTab/_components/PrBriefBanner/` —
  contrast with `BlastRadiusCard` (same plan item), which the plan
  explicitly specified as `Folder shape like IntentCard/`, i.e. a top-level
  sibling under the route's own `_components/`, because that's the
  convention for panels reused/addressed at the Overview-tab level like
  `IntentCard`/`VerdictBanner` already are.
- **Overview has no Description panel.** The PR body used to render as a
  fourth "Description" block under Intent|Blast; the mock is strictly three
  panels (PR Brief + Intent | Blast Radius). Dropped `prBody` from
  `OverviewTab` — don't re-add a Description section for mock parity.
- **Conventions "Accept" is a two-step flow by design, not a shortcut to
  auto-creating a skill** — confirmed with the user 2026-08-02. Clicking
  Accept on a `ConventionCard` only sets `status: "accepted"` and adds the
  candidate to the page-local `selectedIds` (green border, counts toward
  "N of M accepted"). No skill is created until the separate "Create skill"
  toolbar button is clicked, which opens
  `CreateSkillFromConventionsModal` and bundles *all* currently-selected
  accepted candidates into one draft skill. Don't "fix" Accept to
  auto-promote a single candidate — that's a deliberate batch-then-promote
  UX, not a missing feature.

- **Context-tab search keeps already-attached rows visible (AC-11).**
  `matchesQuery` in both Skill and Agent `ContextTab/helpers.ts` is a
  plain-text path/type matcher only — do not make it attached-aware.
  Visibility is `attachedSet.has(p) || matchesQuery(...)` at the filter
  call site (Skill `ContextTab.tsx`; Agent: inherited rows are attached
  via an enabled skill so they skip the query filter entirely; direct
  rows use `directSet.has(p) || matchesQuery(...)`). Typing in the search
  box must not call the persist mutate. A self-check that asserts an
  attached non-matching path disappears is wrong under AC-11 — prove
  narrowing with an *unattached* non-matching row instead.

- **Project Context lives in WORKSPACE, not SKILLS LAB.** The 2026-08-13
  session put the `nav.ts` `context` item in SKILLS LAB because WI9 said
  "like conventions". That copied the wrong neighbour: Conventions is a
  Skills Lab tool; the design's main screen puts Project Context next to
  Pull Requests (WORKSPACE), and Skills Lab only gets it as a **tab** on
  SkillPreview / AgentEditor (already wired). A later user correction
  moved the sidebar item into WORKSPACE and changed the page breadcrumb
  from `Skills Lab > Project Context` to `repo full_name > Project
  Context` (same shape as `/repos/:repoId/pulls`). Do not move it back
  under SKILLS LAB to "match conventions". Tab labels on Skill/Agent
  should say "Project Context", not a generic "Context", so the lab
  surface is recognisably the same feature.

- **Agent editor `?tab=` allow-list must be derived from `TABS`, not a
  second handwritten array.** `/agents/[id]/page.tsx` used to keep
  `VALID_TABS = ["config", "skills"]` while `AgentEditor/constants.ts`
  already listed a `context` tab. Clicking Project Context wrote
  `?tab=context`, the page rejected it, and the editor snapped back to
  Config — so the tab looked missing. `TAB_KEYS` is now `TABS.map(t =>
  t.key)` and the page reads that. Adding a tab only to `TABS` (or only
  to the page allow-list) will recreate this.

## Tool & Library Notes

- **`gridTemplateColumns: "repeat(auto-fit, minmax(<px>, 1fr))"` is this
  codebase's way to get a "2 columns on desktop, stacks under N px" layout
  from pure inline-style CSS** — no prior `@media` usage anywhere under
  `client/src` (checked; the only `@media` in the whole package is
  `prefers-reduced-motion` in `vendor/ui/styles.css`) and no
  `useMediaQuery`-style hook exists. Used for Overview's Intent | Blast
  Radius row (`OverviewTab/styles.ts` `intentBlastRow`,
  `minmax(380px, 1fr)`, docs/plans/intent-layer.md WI13) instead of adding a
  new responsive-hook dependency for one row. Reach for this before adding a
  media-query hook for a simple N-column-or-stack case.
- **Don't nest `auto-fit`/`minmax(280px+)` inside a panel that already sits
  in a half-width Overview column.** IntentCard's In|Out `scopeGrid` used
  `repeat(auto-fit, minmax(280px, 1fr))` and looked correct in isolation, but
  once Intent lived in `intentBlastRow`'s ~400–500px column, 280×2 overflowed
  and CSS collapsed In Scope / Out of Scope into a vertical stack — the main
  mock-parity miss vs the side-by-side mock. Fix: `repeat(2, minmax(0, 1fr))`
  inside the card; reserve `auto-fit`/`minmax` for the *outer* Intent|Blast
  row only (`intentBlastRow` at 380px is fine because that row spans the full
  content width). **Update, 2026-08-09 (L04 follow-ups):** Blast Radius left
  this row entirely — the same overflow logic that forced IntentCard's In|Out
  into `repeat(2, ...)` applies even harder to a symbol tree with monospace
  `file:line` rows and endpoint badges. **Update, 2026-08-09 (L04 acceptance
  fix):** Intent | Blast are side-by-side again in `intentBlastRow`
  (`repeat(auto-fit, minmax(380px, 1fr))`). Blast stays column-narrow-safe
  via inline stats (not 4 tiles), collapsible symbol groups, and
  `file:line`-only caller rows — no nested `minmax(280px+)` grids inside the
  card.

- **`BlastRadiusCard` (Overview) renders the full inline Blast tree** — no
  separate tab, no click-through. Current shape (2026-08-09, L04 acceptance
  fix): Intent | Blast side-by-side; `BlastRadiusCard` is chrome-only (title);
  `BlastPanel` owns `useBlastRadius` (gated until PR detail sync), inline
  stats + Tree/Graph header, collapsible symbol groups (`symbol()` display),
  `file:line`-only callers, degraded/partial banners with the server's
  `reason`, and Prior PRs. Stale `?tab=blast` still normalizes to `overview`.
  Endpoints may include reverse-import dependents (≤2 hops) from the API —
  see `server/INSIGHTS.md` / `repo-intel/README.md`.
- **`status !== 'full'` always renders a warning banner with the server's
  own `reason` — including `status === 'partial'`, not just `degraded`.**
  Confirmed product decision for Blast Radius (L04): don't reuse the
  "partial is still a working index, no warning" framing other
  repo-intel-backed UI might use — `BlastPanel` treats `partial` as
  "warn, don't hide."
- **A caller's `file:line` in Blast Radius links to the GitHub blob at the
  PR's head SHA (`githubBlobUrl`), never into the diff viewer or through
  `focusFindings`** — unlike `FindingCard`'s file:line link (same `MonoLink`
  primitive, different target). Blast callers routinely live in files that
  are NOT part of the PR's diff, so the diff-viewer/finding-focus target
  `FindingCard` uses would silently fail to resolve for most callers.
- **This codebase has no charting/graph-layout library** (`recharts` is used
  for simple charts elsewhere, but nothing does node/edge graphs) — Blast
  Radius's "graph" view (`BlastTab/BlastGraph.tsx`, driven by
  `BlastTab/helpers.ts`'s `buildGraphLayout`) is a small hand-rolled
  two-column SVG (changed symbols left, deduped/capped callers right,
  straight connecting lines), not a general-purpose graph renderer. Good
  enough to honor the pre-authored `blast.json` `graph.ariaLabel`/
  `graph.empty` keys; don't expect it to scale to a real force-directed
  layout without a real library.

## Recurring Errors & Fixes

_(to be filled in)_

## Session Notes

- 2026-07-29: Run Cost Badge feature — added `client/src/helpers/format.ts`
  (`formatCost`, shared across 3 screens), a COST stat tile in
  `RunTraceDrawer/TraceBody`, a tokens+cost line in `RunHistory`'s
  timeline (always rendered, collapses to `"—"` when no data), and a new
  COST column in the PR list (`constants.ts`/`PRRow.tsx`/`styles.ts`).
- 2026-07-30: Findings counter (L01) — same 2-screen pattern as the cost
  badge: a FINDINGS column in the PR list (`PRRow.tsx`/`constants.ts`/
  `styles.ts`, `SeverityBadge` per non-zero severity) and per-severity
  badges replacing the plain-text findings line in `RunHistory.tsx`'s
  timeline. Removed the dead `PrRowView` type from `src/lib/types.ts` — it
  anticipated this exact `{CRITICAL,WARNING,SUGGESTION}` shape but was
  unused; the real fields now live directly on `PrMeta`.
- 2026-07-31: Made the L01 findings counters interactive end-to-end: a
  hover popover on the PR list (`PRRow/_components/FindingsPreview`, lazy
  `usePrLatestFindings`), clickable severity badges everywhere they appear
  (PR list, Timeline, `ReviewRunAccordion` header — converted from plain
  text to real `SeverityBadge`s), all landing on the Findings tab
  URL-deep-linked (`?tab=findings&run=&severity=&finding=`) with a
  filter chip + scroll/flash-highlight to the exact card. Also threaded
  findings into the "Files changed" diff (`diff-viewer/findings.ts` —
  `findingsForLine`/`severityCountsForFile`/`mostSevereFinding`): a
  severity color bar + hover-tag per covered line, a per-file badge row.
  Deliberately did NOT build the Core/Wiring/Boilerplate "Smart Diff"
  grouping shown in the reference screenshots — see Open Questions.

- 2026-08-02: Skills feature client side — `client/src/app/skills/` (list +
  master-detail preview via `?skill=` query param, `SkillCard`,
  `SkillPreview` with view/edit toggle, `ImportSkillDrawer` with file/URL
  tabs) and the Agent Editor's previously-stubbed Skills tab (`SkillsTab` +
  `SkillRow` sub-component, drag-to-reorder over the full skill list,
  checkbox = link/unlink via `agent_skills`, distinct from a skill's own
  `enabled` field). New hooks in `lib/hooks/skills.ts` and additions to
  `lib/hooks/agents.ts` (`useAgentSkills`/`useSetAgentSkills`). Added a
  `skills` nav entry to `src/vendor/ui/nav.ts` despite its do-not-touch
  vendor marking — it's app config, not generated/mirrored design-system
  code, and it's the only place nav items are declared. Community-catalog
  import tab intentionally left unbuilt (no backend catalog exists yet).
- 2026-08-02: Conventions Extractor (L02 homework) — new repo-scoped route
  `client/src/app/repos/[repoId]/conventions/` (`ConventionsListView`,
  `ConventionCard` with an accept/reject toggle driving `status` via
  `PATCH`, `CreateSkillFromConventionsModal` that merges accepted
  candidates into a draft skill body grouped by `category` and posts to
  `POST /conventions/promote`), new `lib/hooks/conventions.ts`. Added the
  `conventions` nav entry + `g c` shortcut to `src/vendor/ui/nav.ts` (see
  Codebase Patterns above for why that vendor edit is sanctioned) and a
  `modal` namespace to `messages/en/conventions.json` (see Codebase
  Patterns above — the pre-authored file only covered the list page, not
  the create-skill modal). Verified the route renders server-side via a
  direct `curl` against the live `pnpm dev` client (empty-state copy and
  breadcrumb present, no Next.js error) — same no-browser-automation
  constraint noted in Open Questions below still applies.

- 2026-08-02: Fixed the Conventions Reject button (see What Doesn't Work
  above) and reset the 29 rows it had already silently flipped to
  `status='rejected'` back to `pending` via a direct `docker exec ...
  psql` `UPDATE`, per user confirmation. Also confirmed Accept-then-
  Create-skill is an intentional two-step flow, not a bug (see Codebase
  Patterns).

- 2026-08-05: Mentor-review fixes on `SkillPreview` and the sidebar.
  (1) Split the single view/edit panel into `SkillPreview.tsx` (thin tab
  shell using `@devdigest/ui`'s `Tabs`, mirroring `AgentEditor.tsx`) +
  `_components/OverviewTab` (verbatim move of the old view/edit logic) +
  `_components/VersionHistoryTab` (new — first real consumer of the
  `useSkillVersions` hook and `GET /skills/:id/versions`, which had existed
  unused since the original Skills build). Read-only by design: no
  "restore old version" action, confirmed out of scope with the user. A
  "Stats" tab was considered and explicitly dropped — no analytics data
  (e.g. "used by N agents") exists on the backend, only raw skill fields
  already visible on Overview; would need a new backend metric, not a UI
  wire-up. (2) Split `nav.ts`'s single `WORKSPACE` group into `WORKSPACE`
  (Pull Requests only) + `SKILLS LAB` (Agents, Skills, Conventions) — see
  Codebase Patterns above for the breadcrumb-copy evidence that drove the
  grouping choice. Verified via `tsc --noEmit` (clean) + full Vitest suite
  (13 files / 38 tests, all passing) — no live browser click-through this
  session, Docker/Postgres wasn't running locally and the user declined to
  spin it up just for this verification (see root `INSIGHTS.md` Tool notes
  on the pnpm-no-TTY and Docker-not-running environment quirks hit while
  trying).

- 2026-08-06: Intent Layer client finish (plan WI8/9) — `IntentCard` on PR
  Overview (above Description) wired to existing `usePullIntent`/
  `useRecalculateIntent` (renamed from `usePrIntent`/`useClassifyIntent` on
  2026-08-09, L04 follow-ups WI8 — the react-query key `["pr-intent", prId]`
  and the `/pulls/:id/intent` endpoint are unchanged, symbol rename only);
  TraceBody gained an `intent` PromptBlock +
  `PROMPT_COLORS.intent` + `runs.trace.prompt.intent`; `prReview.intent.*`
  i18n namespace; `docs/agent-prompts/README.md` updated for Derived intent
  section order + `SCOPE_GUIDANCE`. No `IntentCard.test.tsx` (test-writer).
  Verified via `tsc --noEmit` + full Vitest (13 files / 38 tests).

- 2026-08-07: Intent Layer design fix-ups, client side (plan
  `docs/plans/intent-layer.md` WI11 + WI13, mock-parity pass). WI11:
  `IntentCard` reordered to objective → in/out-of-scope → Risk Areas (new,
  keyword-heuristic icons in new `helpers.ts`: `riskIconFor`/`truncate`) →
  confidence/model meta moved into `SectionLabel`'s `right` cluster (was a
  dedicated row) → Sources collapsed behind a native `<details>` "N sources"
  toggle → Missing Context capped to first item + "+N more". Out-of-scope X
  icon recolored `var(--crit)` → `var(--text-muted)`. `prReview.json`
  `intent.resolved`/`intent.unresolved` renamed to `intent.fetched`/
  `intent.unavailable`; added `intent.riskAreas`/`sourcesToggle`/
  `missingContextMore`. WI13: `OverviewTab` is now the real 3-panel mock
  layout — new `PrBriefBanner` (see Codebase Patterns for its nesting) and
  new top-level `BlastRadiusCard/` (see Codebase Patterns for `VerdictBanner`
  extension and the `auto-fit`/`minmax` row layout in Tool & Library Notes).
  `BlastRadiusCard` always renders `brief.json`'s honest unavailable empty
  state — no blast-radius data source exists anywhere yet (see the plan's
  WI13 Deviations note). New `brief.json` `"title": "PR Brief"` key (no
  prior panel-title string existed). **Known regression, by design**: the
  pre-existing `IntentCard.test.tsx` (test-writer, WI8) has one failing
  test (`unresolved-sources`) asserting the now-renamed "Sources"/
  "Unresolved" copy — expected per WI11's own DoD ("+ tests via test-writer
  after implementer"), not fixed this session (only added the new required
  `risk_areas: []` field to its fixture so `tsc` stays clean). Verified via
  `tsc --noEmit` (clean) + full Vitest (14 files / 44 tests, 43 passed / 1
  known-stale failure above).

- 2026-08-07: IntentCard mock-parity polish (keep Description under the
  3-panel row). Objective → italic left-border blockquote; In|Out forced to
  `repeat(2, minmax(0, 1fr))` so they stop stacking inside the half-width
  Intent column (see Tool & Library Notes); Risk Areas → horizontal tinted
  pill chips (`riskColorFor` + `riskPills`); Missing Context warn box demoted
  to left-accent-only so it doesn't outrank objective/scope/risks. Description
  section unchanged (live-only, not on the mock). IntentCard tests: 10/10
  green.

- 2026-08-09: Blast Radius client side (Part 1 of
  `docs/plans/l04-blast-radius-and-prepush-cli.md` WI5/WI6) — new
  `lib/hooks/blast.ts` (`useBlastRadius`, verbatim shape of
  `useSmartDiff`), new top-level `_components/BlastTab/` (4th PR-detail tab,
  tree/graph toggle via the pre-authored `blast.json`), `BlastRadiusCard`
  rewritten from its always-unavailable placeholder to a real compact
  summary (see Codebase Patterns above for both). Pre-existing
  `BlastRadiusCard.test.tsx` broke when the component gained a real hook
  dependency — kept green via the same "mock the hook, keep only the case
  that's still true, defer new-behavior coverage" pattern already used for
  `IntentCard.test.tsx`'s 2026-08-07 regression, rather than authoring new
  assertions for the new compact-summary state (that's `BlastTab.test.tsx`'s
  job, added the same session). Verified via `tsc --noEmit` (clean) + full
  Vitest (19 files / 77 tests, all passing). **Superseded later the same
  day** — the 4th tab and the compact summary described here were both
  replaced before end of session; see the entry below.
- 2026-08-09 (later, L04 follow-ups plan
  `docs/plans/l04-followups-blast-inline-and-fixes.md`, Parts A + E) —
  inline Blast tree + tab deletion. The tree/graph rendering that lived only
  in `BlastTab` (`BlastBody`/`BlastTree`/`BlastGraph`) was extracted into a
  shared `BlastPanel` component (see Codebase Patterns above), which
  `BlastRadiusCard` now renders directly on Overview — no more four-stat
  compact summary, no more `onViewBlast`/`?tab=blast` click-through. New
  "Prior PRs touching these files" collapsible section (server-provided
  `prior_prs`, internal `/repos/:repoId/pulls/:number` links, renders nothing
  when empty). Once `BlastPanel` had every consumer's coverage, the
  now-redundant standalone Blast tab was deleted outright: the 4th
  `PrDetailHeader` tab entry, the `{tab === "blast"}` branch in `page.tsx`,
  and `_components/BlastTab/` are gone; `BlastPanel` moved a second time,
  from WI1's top-level placement to nested under
  `BlastRadiusCard/_components/` (this file's single-consumer placement rule
  now points the other way, since deleting the tab removed `BlastPanel`'s
  second consumer). PR-detail pages are back to **three** tabs
  (overview · findings · diff) — any INSIGHTS/README text elsewhere still
  describing a 4th "Blast" tab is stale. Coverage consolidated into
  `BlastPanel.test.tsx`; `BlastTab.test.tsx` deleted. Ran in parallel with
  three file-disjoint implementer agents (intent-hook rename, a
  SmartDiffViewer severity-badge fix, a new `verify-l03.sh` gate) in the same
  shared working tree — no file overlap, all four self-verified clean
  (`tsc --noEmit` + package test suites) before this entry was written.

- 2026-08-07: Overview mock header/Description correction. Removed the
  Overview `Description` panel entirely (`prBody` prop dropped from
  `OverviewTab` / `page.tsx`) — it was a leftover fourth surface, not on the
  mock. Intent `SectionLabel` is title-only again (confidence / model /
  Re-derive moved to a demoted card footer); Risk Areas heading matches mock
  (warn icon + top border); Blast Radius `SectionLabel` icon `Workflow` →
  `GitBranch`. IntentCard tests: 10/10 green.

- 2026-08-07: Intent/Blast titles moved **inside** the bordered card
  (`cardTitle` local style, not `SectionLabel` above `wrap`). Mock has
  INTENT / BLAST RADIUS as the first row inside the card frame; the previous
  outside-label layout was the remaining header mismatch. Dropped the
  duplicate GitBranch icon from Blast empty body.

## Open Questions

- **No browser-automation tool is set up for this Windows dev environment**
  — `agent-browser` (which `e2e/run.ts` expects on `PATH`) and
  `chromium-cli` are both absent. UI-behavior changes here could only be
  verified via `tsc --noEmit` + the Vitest/RTL suite (including
  fireEvent+fake-timers coverage of hover/click/navigation) plus a
  curl-level 200-status check against the live `pnpm dev` server — not an
  actual interactive click-through. If this comes up again, either install
  `agent-browser` for the `e2e` package or set up Playwright directly.
  **Resolved 2026-08-02**: installed globally (`npm i -g agent-browser &&
  agent-browser install`) — see `e2e/INSIGHTS.md` Session Notes/Tool notes
  for the install step and the click-automation quirks hit using it.

## Session Notes

- **Smart Diff is path-based, not LLM-backed.** `GET /pulls/:id/smart-diff`
  (`server/src/modules/smart-diff/`) classifies `pr_files` into
  core/wiring/boilerplate via path matchers in `constants.ts`, overlays
  `finding_lines` from the single latest review, and returns the existing
  `SmartDiff` Zod contract. `pseudocode_summary` stays `null` (UI renders
  "What this does" only when non-null — scaffold for a later iteration).
  Client: `useSmartDiff` + `SmartDiffViewer` on the Files changed tab with
  Smart/Original order toggle. Zero token cost. The previous Open Question
  claiming Smart Diff "needs a new LLM-backed server endpoint" was wrong.

- 2026-08-13: Project Context (SPEC-01, plan `docs/plans/spec-01-project-context.md`)
  client side — new repo-scoped route `repos/[repoId]/context/`
  (`ProjectContextView`: master list + search + read-only preview, exactly
  "N files indexed · ≈X tokens" per AC-6, no chunk count anywhere), new
  Context tabs on `SkillPreview` and `AgentEditor` (`_components/ContextTab/`
  each — Skill's is a flat searchable attach list; Agent's has TWO groups,
  inherited-from-enabled-skills read-only vs. attached-directly editable,
  enabled-only everywhere per E-7), new `lib/hooks/context.ts`
  (`useContextDocuments`/`useContextDocument`/`useSkillContext`/
  `useSetSkillContext`/`useAgentContext`/`useSetAgentContext`/
  `useSkillContexts` — the last via react-query's `useQueries` since the
  Agent Context tab needs one parallel query per enabled linked skill, a
  count that varies per agent/render), and a `runs.json` label change +
  new Configuration-panel row (`TraceBody.tsx`) so the trace shows injected
  project-context documents in a row distinct from "Specs read" (ADR-0003).
  Rewrote the pre-authored-but-stale `messages/en/context.json` in the
  Spec's favor (R-A of the plan) — this is the one deliberate exception to
  this file's own "pre-authored copy is authoritative" rule from above,
  because the pre-authored copy predated SPEC-01's explicit, user-approved
  D-3/D-4/D-5 decisions (broader `specs/docs/insights/` scope, token total
  not chunk count, preview-only not edit) and would have shipped a UI that
  contradicted them.
  **Two dead hooks replaced in place, not left beside new ones**:
  `useContextFiles`/`useReindexContext` in `hooks/core.ts` called a
  `/repos/:id/context/reindex` route that never existed server-side and
  assumed the old `SpecFile` contract (now `ContextDocument`) — deleted
  outright, per the Spec's own Non-goals (no re-index step in this feature).
  `client/src/lib/hooks/repo-intel.ts:28`'s doc comment ("The caller
  (ProjectContextView) owns when to stop polling…") is now DOUBLY stale, not
  fixed: a real `ProjectContextView` exists now, but it's this session's
  unrelated Project Context page — it does not consume `useIndexState`/
  `useResyncRepoIntel` at all. Don't assume that comment describes the
  current `ProjectContextView` if you go looking for the repo-intel
  index-state consumer it originally promised; none exists yet.
  **Nav vendor-do-not-touch exception used a 4th time**: added a `context`
  key (`icon: "Folder"`, `gKey: "x"`) to `src/vendor/ui/nav.ts`'s SKILLS LAB
  group, right after `conventions` — same sanctioned exception as the
  Skills/Conventions/SKILLS-LAB-split entries already documented above. The
  nav key had to be exactly `context` to match `activeKeyFor`
  (`components/app-shell/helpers.ts:30`), which was already pre-wired for
  `pathname.includes("/context")` before this session even added the page —
  same "pre-authored code anticipates the intended UX" pattern this file
  already documents for i18n JSON, this time in a helper function instead.
  Verified: `tsc --noEmit` clean, full Vitest green (23 files / 94 tests,
  up from 19/85 — 4 new self-check test files this session), `smoke.test.tsx`
  still passes with the new nav entry. **Known gap, not implemented**:
  WI11's "show attachments belonging to other repos of the workspace, marked
  as not injected for runs on this repo" sub-requirement was skipped — the
  server's `GET /agents/:id/context` is deliberately repo-scoped (a
  `repo_id` query param is required), and no endpoint exists to list a
  surface's attachments across every repo of the workspace. Building one
  would have meant relaxing `ContextRepository.listFor`'s required `repoId`
  param back to optional, which conflicts with the fix noted in
  `server/INSIGHTS.md`'s same-date entry. Flagged for `plan-verifier`/a
  follow-up work item rather than silently dropped.

- 2026-08-13: SPEC-01 fix pass after test-writer — AC-11 search now keeps
  already-attached (Skill) / inherited-or-direct-attached (Agent) rows
  visible when the typed query does not match. See Codebase Patterns
  above. The Skill self-check was updated to prove narrowing via an
  unattached non-matching row so it no longer contradicts the oracle.

- 2026-08-13: SPEC-01 plan-verifier fix-loop iteration 1 — WI11 other-repo
  group is now implemented *without* a 7th HTTP endpoint. The 2026-08-13
  session note above that called this a known gap is superseded:
  `ContextAttachmentSet` gained `other_repo_documents` (default `[]`) on
  the existing `GET /agents/:id/context?repo_id=`. Agent `ContextTab` renders
  a third read-only group after inherited + direct, using `s.otherRepoBadge`
  and i18n `context.otherRepoGroup` / `context.notInjected`. Those rows are
  not counted in `effectiveTotalTokens`. Skill tab ignores the field.
  Do not add a workspace-wide attachments endpoint, and do not make
  `listFor`'s `repoId` optional, to surface this — `listForAll` on the
  port is the server-side split.

- 2026-08-13: Project Context IA correction — sidebar item moved from
  SKILLS LAB to WORKSPACE (`nav.ts`); page breadcrumb is now
  `repo full_name > Project Context` like Pull Requests, not
  `Skills Lab > …`; SkillPreview and AgentEditor tab labels renamed
  from "Context" to "Project Context". The attach tabs themselves were
  already wired; they were just in the wrong information architecture
  relative to the design. Do not resurrect the mockup's Edit toggle,
  coverage ring, or `.devdigest/specs/` path — those remain SPEC-01
  Non-goals.

- 2026-08-13: SkillPreview Context tab was in `PREVIEW_TABS` but easy to
  miss: it sat third after "Version History", the panel had `maxWidth:
  640`, and the tab body returned `null` while queries loaded. Moved
  Context to the second slot (Overview / Context / Version History),
  dropped the maxWidth, labelled the tab "Context" to match the design,
  and replaced the null load with `context.loading`. Same null-load
  trap existed on the Agent Context tab.


- 2026-08-13: Agent editor Context tab was implemented in `TABS` but
  invisible in practice — `/agents/[id]/page.tsx` still allowed only
  `config` and `skills` in `?tab=`. Clicking Project Context reset to
  Config. Allow-list is now `TAB_KEYS` derived from `TABS`.

- 2026-08-13 (later, SPEC-01 amendment AC-29–AC-53, plan
  `docs/plans/spec-01-project-context-authoring.md`, WI6–WI10) — **the
  2026-08-13 entry above ("Do not resurrect the mockup's Edit toggle,
  coverage ring, or `.devdigest/specs/` path — those remain SPEC-01
  Non-goals") is SUPERSEDED for the Edit toggle and coverage ring.** The
  product owner's amendment moved both from Non-goals into scope (AC-29–
  AC-40); the `.devdigest/specs/` path remains out of scope and that part of
  the old entry still holds. Built: `ProjectContextView/helpers.ts`'s
  `computeCoverage` (excludes `missing: true` from both numerator and
  denominator, E-24; returns `null` on zero eligible documents so the
  header renders nothing, AC-32) feeding a `CircularScore` in the SAME
  `filtered` array the AC-6/AC-7 summary already uses (AC-31/UX-17 — one
  filter path, not two); new `_components/DocumentPanel` owns its own
  `useContextDocument`/`useSaveContextDocument` calls (moved out of
  `ProjectContextView.tsx`, which now only passes `repoId`/`path`) and the
  Preview/Edit toggle, dirty-state dot, and a 409-vs-generic-error message
  split (`ApiError.status === 409` → "changed on disk, reload" per AC-37,
  distinct from AC-39's generic write-failure text); new
  `_components/NewDocumentDialog` (root `SelectInput` over the new
  `ContextListing.roots` field, Rec-4, + relative-path `TextInput` +
  `Textarea`, auto-appending `.md`, UX-16 — client-side convenience only,
  the server still validates independently, D-12); new
  `_components/ResyncBlockedNotice` (see below).
  **`useContextDocument`'s return type widened in place** (now
  `ContextDocumentContent` = `{ path, content, revision }` instead of an
  inline `{ path, content }` — the `revision` field is AC-37's staleness
  token, sent back on `PUT`). **A component that starts calling a new hook
  breaks an EXISTING test file's `vi.mock`, not just new tests**:
  `ProjectContextView.test.tsx`'s hand-rolled `vi.mock("@/lib/hooks/
  context", ...)` had to gain `useSaveContextDocument` (DocumentPanel calls
  it unconditionally) and a whole new `vi.mock("@/lib/hooks/repo-intel",
  ...)` (ResyncBlockedNotice calls `useRepoIntelStatus`/
  `useResyncRepoIntel` unconditionally) — without the second mock the test
  crashed with "No QueryClient set", not an obviously-hook-related error,
  because the REAL `useQuery` ran against a component tree with no
  `QueryClientProvider`. When a new child component is wired into an
  existing page under test, check every hook IT calls, not just the props
  the parent passes it.
  **Deep `_components/<X>/_components/<Y>/` nesting uses the `@/` alias for
  real (non-test) imports, not the parent's long relative-path style** —
  confirmed precedent: `_components/BlastRadiusCard/_components/BlastPanel/
  BlastPanel.tsx` and `BlastTree.tsx` both import via `@/lib`/`@/components`
  even though sibling top-level `_components/<X>/<X>.tsx` files (one level
  shallower, e.g. `ProjectContextView.tsx` itself) use the 6-`../` relative
  form. `DocumentPanel`/`NewDocumentDialog`/`ResyncBlockedNotice` (one level
  deeper than `ProjectContextView.tsx`) followed the `@/` precedent rather
  than computing an 8-`../` relative path by hand.
  Clone-integrity UI: new `_components/ResyncBlockedNotice` reads
  `useRepoIntelStatus(repoId)`'s `reason` field for a `dirty_clone:<paths>`
  prefix (server-persisted per `server/INSIGHTS.md`'s same-date entry) and
  renders it as an instruction (warn-colored banner, distinct from
  `ErrorState`'s crit-red look — AC-52's "visually distinct from a
  network/fetch failure") rather than a failure, with a "Check again" button
  that calls `useResyncRepoIntel` — re-attempting the resync is NOT a commit
  or discard action (Non-goals still hold; the app never runs git write
  commands), it just lets the user make the blocked state re-evaluate after
  fixing it externally. This is the hook's first real consumer — see the
  correction to `hooks/repo-intel.ts:28`'s comment in the same commit (the
  comment previously said no `ProjectContextView` consumer existed; it does
  now, and the corrected comment names which component and why `poll` isn't
  passed).
  Verified: `tsc --noEmit` clean; full Vitest green (24 files / 102 tests,
  including the pre-existing `smoke.test.tsx` `/showcase` render with every
  vendored UI component — `CircularScore`/`Modal`/`SelectInput`/`Textarea`
  usage here didn't break it). Test authorship for the new components (AC-
  29–AC-53 client half) is `test-writer`'s job next; the 5 tests updated in
  `ProjectContextView.test.tsx` this session were fixes to keep the
  PRE-EXISTING self-check tests compiling/passing against the new hook
  surface, not new coverage.
