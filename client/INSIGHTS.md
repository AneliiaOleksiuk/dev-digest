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
  content width).

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
  Overview (above Description) wired to existing `usePrIntent`/
  `useClassifyIntent`; TraceBody gained an `intent` PromptBlock +
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