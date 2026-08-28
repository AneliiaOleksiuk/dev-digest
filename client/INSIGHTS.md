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

- **`critical_paths`/`reading_path`/`run_locally` `OnboardingSection.body` is
  markdown-only — there is no structured per-row field for these three kinds**
  (unlike `first_tasks`, which got a real `tasks[]` array in FIX-8 — see the
  entry below). The design's file-row/numbered-circle/per-command-copy layout
  has to be recovered by PARSING that markdown client-side:
  `SectionCard/parseSection.ts`'s `parseListItems(body)` groups top-level
  bullet/numbered lines (a continuation line belongs to the preceding item,
  same rule as the server's own `capBulletItems`/`groundBulletItemPaths` in
  `server/src/modules/onboarding/helpers.ts`) and pulls the first inline-code
  span out as `path`. `run_locally` needs a SECOND shape entirely:
  `parseRunLocallyCommands(body)` reads fenced-code lines when the LLM
  actually ran (`groundRunLocallyBody` only ever fences), but falls back to
  the bullet-list-of-inline-code shape `buildSkeletonSections` emits for
  `run_locally` (`` - `command` (from `path`) ``, never fenced) — the
  deterministic skeleton and the real LLM output are NOT the same markdown
  shape for this one section kind. Both parsers fall back to the plain
  `Markdown` render when they find zero rows, so an unexpected body shape
  never renders blank (same "never an empty card" contract `hasBody` already
  had).

- **Adding a single-item "expand + scroll to it" deep-link to an already-
  uncontrolled list-of-`FileCard`s viewer does NOT require lifting the whole
  list into controlled state (2026-08-14, SPEC-03 AC-30/E-22,
  `components/diff-viewer/DiffViewer/DiffViewer.tsx`).** `DiffViewer` had no
  jump capability at all before this — every `FileCard` was fully
  uncontrolled (auto-expand based on `AUTO_EXPAND_MAX_LINES`). Rather than
  building a full `openMap` (the shape `SmartDiffViewer` already has, since
  it needed per-file control anyway), track only a single `forcedOpenPath`
  in local state; when rendering the file list, spread `FileCard`'s existing
  controlled `open`/`onOpenChange` props onto ONLY the one file matching that
  path, and pass NEITHER prop for every other file (leaving them in their
  normal uncontrolled mode, `AUTO_EXPAND_MAX_LINES` default intact). This is
  the general technique for adding a single-item focus/deep-link feature to
  an already-shipped uncontrolled list component without regressing every
  other item's existing behavior — reach for it before reaching for a full
  controlled-map rewrite. `SmartDiffViewer` needed no new pattern here — it
  already had per-file `openMap` state for its own finding-badge clicks, so
  the deep-link was just a `useEffect` invoking its existing internal
  `onJumpToLine(path, line)` whenever an external `externalFocus` prop
  changes (guarded by `fileByPath.has(path)` so an absent path is a safe
  no-op, matching `DiffViewer`'s equivalent `files.some(...)` guard).

- **A history/timeline list endpoint that returns each entry's FULL nested
  record (not a summary row) lets the client render a historical entry with
  ZERO additional requests (2026-08-14, SPEC-03 Why Timeline,
  `PrBriefCard`'s `BriefTimeline`).** `GET /pulls/:id/brief/timeline` returns
  `entries[].record: BriefRecord` inline — a server design choice ("two
  endpoints, not three") — so clicking an older Why Timeline row just swaps
  local component state to that entry's already-fetched `record`; no new
  fetch, no loading state, no risk of the detail view disagreeing with the
  list view. Worth defaulting to this shape for any future "browse a bounded
  history, then drill into one entry" feature (the list here is capped at 50
  rows) rather than a summary-list + per-item-detail-fetch split.

- **No per-case-across-batches read exists server-side for the Eval
  Pipeline (2026-08-21, L06, docs/plans/eval-pipeline.md WI9/WI12).** The
  server's eval module has `GET /agents/:id/eval-cases` (no run info at
  all) and `GET /eval-batches/:id` (a batch's own per-case rows), but
  nothing answering "this case's most recent run, across whichever batch it
  last ran in." To show each case's last pass/fail + recall in the Agent
  Editor's Evals tab (AC-35), `EvalsTab/helpers.ts`'s `buildLastRunByCase`
  reconstructs it client-side: walk an agent's recent batches NEWEST FIRST
  (`EvalDashboard.recent_runs`, capped to 5 via a new `useEvalBatches`
  hook — `lib/hooks/eval.ts`, a `useQueries`-based addition beyond the 12
  hooks the plan named by name, same shape as `hooks/context.ts`'s
  `useSkillContexts`) and take the first run matching each `case_id`. This
  is only fully correct when every batch walked contains every case that
  existed at that time — true for a "run whole set" batch
  (`POST /agents/:id/eval-runs`), but NOT for a single-case run
  (`POST /eval-cases/:id/run`, a ONE-CASE batch): running just one case
  makes every OTHER case's last-run display fall back to whatever it showed
  in the last full-set batch, even if that's now stale relative to the
  just-run case. No dedicated endpoint exists to fix this properly —
  documented as a known limitation in the helper's own doc comment, not
  silently presented as exact.
- **`hooks/eval.ts` imports its contract types from `"../types"`
  (`lib/types.ts`), not `"@devdigest/shared"` directly — following
  `hooks/brief.ts`'s precedent, not `hooks/agents.ts`'s/`hooks/reviews.ts`'s
  (2026-08-21, L06).** Both import styles coexist in this codebase; which
  one to follow isn't arbitrary per-file taste — `docs/plans/eval-pipeline.md`
  WI9 explicitly said "re-export via `lib/types.ts`, the file's own header
  says to add them there," and `lib/types.ts`'s own header comment says the
  same. When a plan/spec names the file's own stated convention, follow
  that over whichever sibling hook file happens to be open.

- **`src/vendor/ui/ExportWizardSteps.tsx` and `AutoTriggerStatus.tsx` were
  pre-existing, barrel-exported, and completely unused until the Export to
  CI wizard (2026-08-23, SPEC-04 Phase D, WI20)** — the same "pre-authored
  scaffolding anticipates the intended UI" pattern this file already
  documents for `messages/en/*.json` (see the Skills/Conventions/Agents
  entries above), just for a *vendor component* this time instead of i18n
  copy. `ExportWizardSteps` is exactly the numbered horizontal step
  indicator AC-1 needed (`{step, labels}` props, done/active/pending
  states) — used as-is with zero changes for the wizard's Target → Preview
  → Configure → Install progress bar. Worth grepping `src/vendor/ui/*.tsx`
  (not just `messages/`) for an unused, feature-shaped component before
  building a new one from scratch when a route name in a plan matches an
  existing vendor file's name closely.
- **One shared `WizardState` + one `buildExportInput(state)` function feeding
  Preview/Install/Zip is what makes AC-1 ("Back restores a hand-edited
  workflow") and UX-1 ("Configure changes re-sync Preview") both true
  without separate reconciliation code (2026-08-23, ExportWizard).** All
  wizard state (`repo`, `triggers`, `postAs`, `ingestUrl`,
  `workflowOverride`, `files`) lives in the top-level `ExportWizard.tsx`,
  never per-step local state — `step` is the only thing that changes on
  Back/Continue, so nothing ever remounts and nothing needs an explicit
  "restore" path. Toggling a trigger or changing `post_as` on Configure
  calls the exact same `buildExportInput` used by Preview/Install, passed
  via an `overrides` param (not read from the just-set state, which would
  be stale inside the same event handler) — this is the general shape for
  "a wizard step's edit must be reflected consistently by every other step
  that also submits a request," not something specific to CI export.

## Tool & Library Notes

- **`src/lib/api.ts`'s `apiFetch` always calls `res.json()` — a binary
  response (e.g. `POST /agents/:id/export-ci/zip`'s `application/zip`)
  needs a second function, not a special-cased branch inside `apiFetch`
  (2026-08-23, SPEC-04 Phase D).** Added `apiFetchBlob`/`api.postBlob` as a
  sibling to `apiFetch`/`api.post` in `api.ts` itself — same error-handling
  shape (network failure → `ApiError` with `status: 0`, non-2xx → parse a
  JSON error body if present), just `res.blob()` instead of `res.json()` on
  success. Keeps the "no ad-hoc `fetch` in a component" rule intact for any
  future binary-response endpoint instead of reaching for `fetch` directly
  in the hook.
- **On this shared dev machine, whatever process already owns `:3001` may
  belong to a DIFFERENT worktree, not this one (2026-08-23).** Before
  trusting a `curl http://localhost:3001/...` result as "this worktree's
  API," check the owning process's actual command line —
  `Get-NetTCPConnection -LocalPort 3001 -State Listen | select
  OwningProcess` then `Get-CimInstance Win32_Process -Filter
  "ProcessId=<pid>" | select CommandLine` — since a stale/other-worktree
  server answers real HTTP 200s on unrelated routes and only reveals itself
  as wrong via a 404 on a route your own worktree's code just added. This
  session's `:3001` was a `D:\htdocs\devDigest\server` process pre-dating
  the `ci` module (confirmed via `/ci/runs` 404-ing there while `/eval-
  dashboard` 200'd). Fix: start your OWN instance on a different `API_PORT`
  (env var, `server/src/platform/config.ts`) against the same shared
  Postgres container rather than restarting/killing a process you don't
  own — verified this way for CI export's Preview/Zip routes, then killed
  only the throwaway instance afterward.

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

- **`--border` (#2a2a2a) is too subtle against `--bg-elevated` (#1c1c1c) for a
  card/row that needs to read as visibly outlined** — barely distinguishable
  in practice. `--border-strong` (#3a3a3a) is the token this codebase already
  uses when an outline needs to actually be seen (e.g. `Button`'s `secondary`
  kind, `SectionCard`'s `openButton`). Onboarding's `taskCard`/`fileRow`/
  `commandRow` (2026-08-14, design fix-up after a user screenshot comparison)
  switched from `--border` to `--border-strong` for exactly this reason —
  reach for `--border-strong` by default for any new bordered card/row on a
  dark elevated surface, not `--border`.

- **`@devdigest/ui`'s `LineChart` (`vendor/ui/charts/LineChart.tsx`) fills a
  missing index in a shorter series with a hard-coded `0`, not a gap
  (2026-08-21, L06 Eval Pipeline, AC-39/E-7/E-11).** Row-building is
  `row[s.name] = s.data[i] ?? 0` — there is no `null`/`undefined` support
  and no `connectNulls`, so passing a metric straight through when it's
  legitimately undefined for that point (e.g. a batch with no findings at
  all, `citation_accuracy: null`) would render as a real, misleadingly LOW
  point instead of "no data here." Its OTHER default, `yMin=0.6, yMax=1.0`
  (already the subject of AC-39/E-7 — always pass explicit `yMin={0}
  yMax={1}`), is the well-known trap; this zero-fill behavior is a second,
  separate trap in the same file. Since it's vendored/do-not-touch, the only
  honest fix without editing it is to filter each metric's series
  independently before handing it to `LineChart` (drop null points per
  series, don't substitute 0) — `AgentEvalDetail.tsx`'s `trendSeries` does
  this, with an on-screen caption noting the tradeoff: multi-series charts
  built this way do NOT preserve x-axis alignment across series when their
  null patterns differ. Worth knowing before reusing `LineChart` for any
  other per-point-nullable metric.
- **`next-intl`'s missing-message fallback renders the literal message path
  as visible text, not an empty string** (2026-08-22) — a missing
  `t("nav.evals")` renders `"nav.evals"` inline (e.g. "Go to nav.evals" /
  "Go to shell.nav.evals" depending on namespace scope), confirmed by
  actually reverting the `client/messages/en/shell.json` fix and re-running
  the test; don't assume a missing key silently blanks out. Separately,
  `client/src/vendor/ui/command-palette/CommandPalette.tsx` is gated
  `if (!open) return null` — its command labels (built by
  `useShellCommands.ts`, one `t(`nav.${it.key}`)` call per `NAV` item) are
  computed unconditionally during SSR (the `useMemo` runs either way) but
  never reach the DOM unless a user has actually opened the palette
  (Cmd/Ctrl+K). A plain `curl` of a page's initial HTML therefore cannot
  prove or disprove a `nav.ts`-key ↔ `shell.json` `nav.<key>` mismatch for
  this component — only `next build`'s static-generation error (real, hard
  failure: `Error: MISSING_MESSAGE: shell.nav.evals (en)`) or a hook-level
  test rendering the real `useShellCommands()` against a real
  `NextIntlClientProvider` + real `messages/en/shell.json` (no mocks — see
  `client/src/components/app-shell/hooks/useShellCommands.test.tsx`) proves
  it either way.

## Recurring Errors & Fixes

- **A native `<select>`'s open dropdown popup renders unreadable
  light-on-white text if the `<select>`'s own `background` is
  `"transparent"` (2026-08-13).** `src/vendor/ui/kit/SelectInput.tsx` had
  `background: "transparent"` on the `<select>` with no color set on its
  `<option>` elements. The **closed** box looks fine (inherits the parent
  div's dark background), but the browser paints the **open popup** using
  the `<select>` element's own `background-color` — "transparent" falls
  back to the OS/browser default (white) — so combined with the light
  `--text-primary` color, every option was invisible until clicked at
  random. Symptom as reported by a user: "can't select anything / nothing
  seems clickable" — it wasn't a click-handling bug, the options were
  simply unreadable. Fix: set an explicit `background` (e.g.
  `var(--bg-elevated)`) on both the `<select>` and every `<option>`, not
  just `color`. Verified via a real headless-Chromium screenshot of the
  opened dropdown (not just reading the CSS) — this class of bug is easy
  to miss by code review alone since the closed state looks correct.
- **A bare `gridTemplateColumns: "1fr 1fr"` lets one column's unbreakable
  content collapse its sibling to one character per line when combined
  with `wordBreak: "break-all"` (2026-08-13).** Found in two places
  independently (`app/skills/_components/SkillPreview/_components/
  ContextTab/styles.ts` and the equivalent Agent Context tab) — selecting
  an item with long preview content (a code block, a long URL) squeezed
  the sibling list column down to a single character per row. Root cause:
  a bare `1fr` grid track's `min-width` defaults to `auto`, i.e. its
  content's min-content size — if the *other* column's content can't
  shrink below some width (unbreakable text), the grid steals space from
  the column that *can* shrink, and `wordBreak: break-all` lets that
  shrinkage go all the way to single characters. Fix: always use
  `minmax(0, 1fr)` instead of bare `1fr` for a two-column grid where
  either side might hold long/unbreakable content — forces genuinely equal
  track sizing regardless of content, each side then scrolls/wraps
  internally instead of stealing from its sibling.
- **Next.js dev server can serve a stale/confused bundle with zero console
  errors after many new files are added while it's still running
  (2026-08-13).** After an `implementer` agent added ~15 new component/
  hook files to a running `pnpm dev` session, the live page got stuck
  showing only its loading skeletons forever (3 `<Skeleton>` bars, no
  content, no error) — reproducible via a real Playwright screenshot, not
  just user report. `rm -rf client/.next` + restarting `pnpm dev` fixed
  it (confirmed via a clean recompile log,
  `✓ Compiled /repos/[repoId]/context in 586ms`). Cheap first thing to try
  whenever a live page behaves inexplicably (stuck loading, partial
  render) right after a session added a lot of new files to a dev server
  that was never restarted — before spending time debugging application
  code. Note: this was **not** the actual root cause of the bug report
  that prompted it — the app relaunching fixed the caching symptom, but
  the user's other complaints (unreadable dropdown, collapsed grid column)
  turned out to be the two real bugs above, only discoverable once the
  stale-bundle red herring was ruled out first.
- **A pre-wired `activeKeyFor` prefix check can anticipate the WRONG nav key,
  not just anticipate one early (2026-08-21, L06 Eval Pipeline client,
  docs/plans/eval-pipeline.md WI13).** `components/app-shell/helpers.ts`
  already had `if (pathname.startsWith("/eval")) return "eval";` sitting
  unused, presumably guessed ahead of time the same way `/context` and
  `/conventions` were pre-wired before their `nav.ts` entries existed (see
  the Codebase Patterns entries above) — but the plan's actual required
  `nav.ts` key is `"evals"` (plural), so the pre-wired singular string never
  matched and the sidebar item would have stayed permanently unhighlighted
  on `/evals` if shipped as-is. Fixed alongside adding the `nav.ts` entry:
  `pathname.startsWith("/evals")` → `"evals"`. Generalizes the existing
  onboarding-tour lesson ("pre-authored code anticipates the intended UX,
  but check it for collisions before trusting it verbatim") one step
  further: also check that the pre-wired STRING it returns is the exact key
  you're about to add, not just that the route-prefix check fires at all —
  grep `activeKeyFor` for the feature's own prefix before assuming a hit
  there is already correct.
- **Running `next build` while a `next dev` process is already live on the
  same `client/.next` directory (Windows) leaves the dev server broken
  afterwards** (2026-08-22) — the build itself completes fine and doesn't
  error, but the dev process silently starts 500ing subsequent requests
  once the build finishes (observed: `curl` against a route that was 200
  moments earlier now 500s, with nothing new in the dev server's own log
  beyond a stale/earlier error). If a fix-loop task needs BOTH a `next
  build` verification and a live `curl`/`next dev` verification in the same
  session: run the build first, then explicitly find and kill whatever
  process already owns the dev port (`Get-NetTCPConnection -LocalPort
  <port> | Select-Object OwningProcess`, `Stop-Process -Id <pid> -Force` on
  Windows) — don't assume a `next dev` you didn't just start yourself is
  healthy just because it responded 200 earlier in the session — delete
  `.next`, and start a fresh `next dev` before trusting any `curl` result
  against it.
- **A controlled `<input type="date">` whose `value` is bound directly to a
  URL-derived prop, with `onChange` synchronously round-tripping through
  `router.replace()` on every event, breaks the native date picker — both
  "calendar icon does nothing" AND "can't finish typing a full date, one
  segment never sticks" (2026-08-28, SPEC-06 fix-loop).**
  `components/range-selector/RangeSelector.tsx`'s custom-range inputs did
  `value={value.start ?? ""}` / `onChange={(e) => onChange({...,
  start: e.target.value})}`, where `onChange` immediately called
  `router.replace()` to push the new value into the URL. The browser's own
  `<input type="date">` reports a transitional/incomplete value while a
  segment is still being edited; round-tripping THAT straight back down as
  this component's controlled `value` prop forces React to reset the DOM
  node's value out from under the user mid-edit, which also interrupts the
  native picker popup (some engines close/reset it when the controlling
  input's value is programmatically touched while open). **Fix:** keep the
  input controlled by LOCAL component state (`useState`), and only call the
  parent's `onChange` (which triggers the URL/fetch round trip) once the
  browser reports a genuinely COMPLETE date — i.e. guard on
  `if (e.target.value) { ... }`, since a native date input only reports a
  non-empty value once every segment is valid. Re-sync local state from the
  prop via `useEffect` for genuinely external changes (browser back/forward)
  — never on the component's own commits, which already match by the time
  they round-trip back down. This is a general pattern for ANY controlled
  input feeding a router-synced/URL-synced value, not specific to dates.
- **A range-scoped React Query hook (`useAgentPerf`/`useAgentDetailStats`)
  with no `enabled` guard fires a request on a half-entered custom range,
  which the server correctly 422s — but the UI had no state for that,
  landing on either the generic error state or (once the request was gated
  off) a silent blank page (2026-08-28, SPEC-06 fix-loop A2).** Fix applied
  both ways together: gate the hook itself
  (`enabled: range.range !== "custom" || (!!range.start && !!range.end)`)
  AND add an explicit "enter both dates" validation message in the view,
  keyed off the same completeness check (`isIncompleteCustomRange`,
  `lib/hooks/range.ts`) — gating the hook alone just trades a 422/error
  state for an unexplained blank one; the view-level copy is what actually
  tells the user what to do.

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

- 2026-08-14: SPEC-02 Onboarding Generator (plan
  `docs/plans/spec-02-onboarding-generator.md`) client side, WI10-WI13 — new
  repo-scoped route `repos/[repoId]/onboarding/` (`OnboardingTourView`: five
  collapsible `SectionCard`s in the fixed AC-4 order, a `RegenerateConfirmModal`
  naming both AC-6 consequences before the paid call fires, client-side
  `toMarkdown` export with zero network request), new
  `lib/hooks/onboarding.ts` (`useOnboardingTour` read + `useGenerateOnboardingTour`
  mutation), `messages/en/onboarding.json` fully reconciled to the five
  canonical section kinds (D-6/Q7 — the old copy promised "overview,
  architecture, key modules, getting started, and conventions & gotchas",
  a different five than the tour renders).
  **Nav vendor-do-not-touch exception used a 5th time** (after Skills,
  Conventions, the SKILLS-LAB split, and Project Context): added an
  `onboarding-tour` key to `src/vendor/ui/nav.ts`'s **WORKSPACE** group
  (beside `pulls`/`context` — a reading surface, not a Skills Lab tool, same
  reasoning as Project Context's IA placement), icon `"Workflow"` (an
  EXISTING `IconName` — `icons.tsx` stays untouched, no `"Compass"`/
  `"Download"` icons exist in this registry despite reading like natural
  fits; used `"Workflow"` for the empty-state icon too and `"ArrowDown"` for
  the export button instead).
  **Pre-existing nav/route collision fixed, not left as "already working"**:
  `activeKeyFor` (`components/app-shell/helpers.ts`) already had
  `pathname.includes("/onboarding") → "onboarding-tour"` BEFORE this
  session, pre-wired for a route that didn't exist yet — but that predicate
  also matches the UNRELATED top-level add-repo screen at exactly
  `/onboarding` (`app/onboarding/page.tsx`), which predates this feature and
  means something else entirely. Fixed to
  `pathname.startsWith("/repos/") && pathname.includes("/onboarding")` so
  only the new repo-scoped route highlights the sidebar item — same
  "pre-authored code anticipates the intended UX, but check it for
  collisions before trusting it verbatim" lesson this file's `nav.ts`/
  `activeKeyFor` entries already document for Skills/Conventions/Context,
  just the first case where the pre-wiring was WRONG rather than merely
  early.
  **AC-12's "First tasks" badge is section-level, not per-task-card** — see
  `server/INSIGHTS.md`'s same-date entry for why (`OnboardingSection` has no
  structured per-task array). One "Model estimate" `Badge` (with a `title`
  tooltip, since `Badge` itself has no `title` prop — wrapped in a plain
  `<span title=…>`) on the `first_tasks` card's header.
  **`run_locally`'s copy-to-clipboard button copies the WHOLE section body**,
  not a per-command button — AC-34 only requires display+copy, never
  execution; a single section-level copy action satisfies that without
  needing per-line UI plumbing the flat `body` field doesn't cleanly support.
  Verified: `tsc --noEmit` clean; full Vitest green (28 files / 130 tests —
  no new `*.test.tsx` file this session, per the multi-agent handoff split;
  test authorship for `OnboardingTourView`/`SectionCard`/
  `RegenerateConfirmModal`/`helpers.ts` is `test-writer`'s job next).
  `smoke.test.tsx` still passes.

- 2026-08-14 (fix-loop iteration 1, remediating `plan-verifier`'s Phase 1
  FAIL) — two client-touching fixes:
  - **FIX-4 (client half)**: `sections.length === 0` was the WRONG signal for
    "show degraded copy" — the server skeleton always returns exactly five
    sections (`helpers.ts` `buildSkeletonSections`), so that branch was
    provably dead on the main path and the whole `empty.*` message block
    (no-clone/not-indexed/never-generated/llm-failed copy) never rendered.
    Replaced with a status/reason row sourced DIRECTLY from `tour.status` +
    `tour.reason` (a `Badge` + the server's own reason sentence), shown
    whenever `status !== "ok"`, right in the header alongside the existing
    age/files-indexed/stale row. Collapsed the four per-status `empty.*.title/
    body` i18n keys down to one generic `empty.generic.title` (with
    `tour.reason` as the body) — that branch is now reserved for the
    genuinely-empty case (a corrupted stored row, E-15's `sections: []`
    degrade-on-read path), not a stand-in for every degraded status.
  - **FIX-6**: confirmation (`RegenerateConfirmModal`) is now required before
    the FIRST generation too, not only Regenerate — `handleGenerateClick`
    always opens the modal now; it never calls `mutate()` directly. The modal
    gained a `mode: "generate" | "regenerate"` prop swapping in first-
    generation copy (`confirm.firstTitle`/`firstBody`/`firstConfirmCta`) so
    "regenerate"/"replaces the tour" doesn't read wrong when there's no
    existing tour to replace yet — both modes still show the shared
    `confirm.outboundNotice` line (NFR A04).
  **Known regression, by design** (same pattern as the 2026-08-07 IntentCard/
  BlastRadiusCard entries above): `OnboardingTourView.test.tsx`'s third case
  ("a FIRST-EVER generation... skips the confirm gate — Generate calls
  mutate() directly") now fails, because it encodes the EXACT pre-FIX-6
  behavior FIX-6 exists to change. Left failing intentionally rather than
  hand-edited, since updating a pre-existing self-check test's assertions to
  match new behavior is `test-writer`'s job, not this session's — see FIX-6's
  own text in `docs/plans/spec-02-onboarding-generator-fixes.md`. Verified:
  `tsc --noEmit` clean; full Vitest run is 158 passed / 1 known-failing (the
  case above) — every other file, including `OnboardingTourView/helpers.test.ts`,
  `SectionCard.test.tsx`, and `RegenerateConfirmModal.test.tsx`, stayed green
  with zero changes needed. The pre-existing SectionCard nested-`<button>`
  HTML-validity console warning (visible in this run's stderr) is a known,
  already-flagged Phase-2 Minor finding out of this fix plan's scope — not
  something this session introduced or should silently "fix" as a drive-by.

- 2026-08-14 (FIX-8, mid-loop addition after FIX-1..7, spotted by the product
  owner comparing the live page to the reference screenshot) — "First tasks"
  now renders a per-task card GRID (bold title, monospace path, a per-task
  complexity `Badge`) instead of one markdown `body` blob with a single
  header-level "Model estimate" badge. **This SUPERSEDES the 2026-08-14
  entry above** ("AC-12's 'First tasks' badge is section-level, not
  per-task-card ... `OnboardingSection` has no structured per-task array")
  — FIX-8 added exactly that array (`OnboardingTask`, server `INSIGHTS.md`'s
  same-date entry) and the badge moved from the section header into each
  task card. The old `firstTasksBadge` prop on `SectionCard` and the
  `section.firstTasksBadge`/`section.firstTasksBadgeTooltip` i18n keys are
  DELETED, not deprecated-in-place — they described a design that no longer
  exists, and keeping them around would have looked like a second, competing
  badge mechanism next to the new per-task one.
  **`Badge` (`vendor/ui/primitives/Badge.tsx`) needed ZERO edit for the
  green/amber complexity pill** — it already takes `color`/`bg` as direct
  props (not a named "variant" enum), and this codebase already has an
  established green/amber semantic-token PAIR for exactly this purpose:
  `--ok`/`--ok-bg` (green, `styles.css`) is already used via
  `<Badge color="var(--ok)" bg="var(--ok-bg)">` in `IntentCard.tsx`,
  `TraceBody.tsx`, `VerdictBanner`/`RunHistory`/`pulls/constants.ts`, and
  `--warn`/`--warn-bg` (amber) the same way for warnings elsewhere in this
  file's own entries. Before reaching for a new CSS variable or an inline
  `style` override on `Badge` (which `vendor/ui`'s do-not-touch status would
  make awkward to justify), check whether `--ok`/`--warn`/`--crit`/`--sugg`/
  `--info` in `vendor/ui/styles.css` already covers the semantic you need —
  there is NO `--success`/`--green` name; `--ok` IS the green token.
  **`tsc --noEmit` catches a removed prop as a hard type error, not just a
  stale runtime assertion** — unlike FIX-6's `mode` prop addition (backward
  compatible, old test call sites kept compiling), deleting `firstTasksBadge`
  from `SectionCard`'s props broke `SectionCard.test.tsx`'s two AC-12 call
  sites at the TYPE level. Fixed by removing only the now-nonexistent prop
  from those two call sites (an object-literal edit, not new test content)
  so the file keeps compiling; left the resulting stale assertion
  (`getByText("Model estimate")`, which no longer renders anywhere) failing
  intentionally, per this file's own FIX-6/IntentCard precedent for "the
  compile-fix and the behavior-fix are different jobs." Verified: `tsc
  --noEmit` clean; full Vitest run is 178 passed / 1 known-failing (that one
  AC-12 case, named above) — the sibling AC-12 case ("a non-first_tasks
  section never renders the badge") still passes, now vacuously, since
  "Model estimate" doesn't render anywhere at all post-FIX-8.

- 2026-08-14 (design-conformance fix, user-reported: "sections don't match
  the design at all, you're just dumping raw markdown") — `critical_paths`,
  `reading_path`, and `run_locally` now render through the same structured-
  row treatment `first_tasks` already had, instead of the generic `Markdown`
  fallback. New `SectionCard/parseSection.ts` (+ `parseSection.test.ts`, see
  Codebase Patterns above for the two `run_locally` body shapes it has to
  handle) is a pure client-side markdown parser — no server/contract change,
  since `body` was already carrying everything needed, just unparsed.
  `critical_paths` → one bordered row per parsed item (file icon, mono path,
  description, an "Open" link via the existing `githubBlobUrl` — reusing the
  previously-unwired `section.openAction` i18n key, and `actions.open`, both
  of which existed in `messages/en/onboarding.json` with no call site before
  this). `reading_path` → the same row shape with a numbered circle badge
  instead of a file icon. `run_locally` → one bordered row per command with a
  PER-ROW copy button. **This supersedes the 2026-08-14 entry above**
  ("`run_locally`'s copy-to-clipboard button copies the WHOLE section body,
  not a per-command button ... a single section-level copy action satisfies
  [AC-34] without needing per-line UI") — that header-level copy button is
  now removed entirely (the design has no header copy icon for this section);
  every command gets its own. Also added `actions.copy` to
  `messages/en/onboarding.json` (`"Copy"`) — the pre-existing header copy
  button's `aria-label` had been wired to `actions.export` ("Export as
  Markdown"), a mislabel now fixed since the same `IconBtn` pattern moved
  per-row. `architecture` (prose + `MermaidDiagram`, already bordered) needed
  no change — it already matched the reference design. Verified:
  `tsc --noEmit` clean; `SectionCard`/`parseSection` test files green (58
  tests, only the pre-existing FIX-8 known-stale "Model estimate" case still
  failing, unrelated to this change) — no live browser click-through this
  session (would require a stored/generated onboarding tour and a running
  API+DB; RTL's rendered-DOM assertions covered the new structure instead).

- 2026-08-14 (design-conformance fix, part 2 — user regenerated the tour and
  screenshotted the real result) — two bugs surfaced by REAL LLM-generated
  content that the hand-written unit-test fixtures above hadn't exercised:
  (1) `parseListItems`'s `description` field is rendered as plain text (not
  through `Markdown`), so a body like `` - `path` — **Server entry**: loads
  config`` showed literal `**asterisks**` instead of bold — the LLM's own
  formatting habit (bold sub-headings inline, per `onboarding.system.md:22`'s
  "short Markdown **bold sub-headings**" instruction) leaked straight through
  as raw syntax. Fixed with a new `stripMarkdownEmphasis` in `parseSection.ts`
  (strips `**bold**`/`__bold__`/`*italic*`, deliberately SKIPS single
  `_italic_` because this codebase's real paths/identifiers are commonly
  snake_case — `run_logger.ts` — and a naive strip would corrupt them).
  (2) The generic `section.links[]` list at the bottom of the card was
  rendering the SAME file paths a second time once `critical_paths`/
  `reading_path` had their own parsed rows (each already carrying its own
  "Open" link) — visibly duplicated in the user's screenshot (4 rows above,
  the same 4 filenames again as a compact link list below). Suppressed via a
  new `rowsCoverLinks` check in `SectionCard.tsx` (only when
  `criticalPathRows`/`readingPathRows` actually produced rows — the generic
  links list still renders as a fallback for kinds/cases where structured
  parsing found nothing, e.g. an unparseable body). **Lesson for next time**:
  the original parser tests (this file's entry above) only used hand-crafted
  bullet text without markdown emphasis and without a populated `links[]`
  alongside a parseable `body` — both gaps only surfaced once the user
  actually clicked Regenerate and compared a REAL LLM response against the
  design; a fixture closer to the prompt's own documented style (bold
  sub-headings) would have caught bug (1) without needing a live regenerate.
  Verified: `tsc --noEmit` clean; full onboarding suite green (57 tests, same
  1 pre-existing known-stale case).

- 2026-08-14: SPEC-03 PR Brief & Why Timeline (plan
  `docs/plans/spec-03-pr-brief-and-why-timeline.md`) client side, WI9-WI14 —
  new `lib/hooks/brief.ts` (`usePrBrief`/`usePrBriefTimeline`/
  `useGeneratePrBrief`); `PrBriefCard` (replaces `PrBriefBanner`, deleted
  outright incl. its test — see below) with a nested `BriefTimeline`
  (`_components/BriefTimeline/`, the Why Timeline, D-3); a new `?file=&line=`
  URL-param pair + `focusDiffLine` helper in `page.tsx` (same pattern as the
  existing findings deep-link contract this file already documents); `?file`/
  `?line` threaded through `DiffTab` → whichever viewer is active
  (`SmartDiffViewer` gained an `externalFocus` prop hooking into its existing
  `onJumpToLine`; `DiffViewer` gained jump capability from scratch — see
  Codebase Patterns above for both). `useGeneratePrBrief`'s `onSuccess`
  deliberately does NOT call `qc.setQueryData` for a `budget_exceeded`/
  `failed` response (neither state is ever persisted server-side) — instead
  `PrBriefCard` reads the mutation's own `generate.data` directly to render a
  transient banner IN PLACE over whatever good `record` the `pr-brief` query
  cache already holds, so a failed regenerate attempt never wipes a
  previously-good brief off the card. `PrBriefBanner/` deleted in full
  (component + styles + index + its pre-existing test) per the plan's
  explicit WI11 file list — not new test authorship, a specified deletion of
  an obsolete component's test alongside the component itself. Verified:
  `tsc --noEmit` clean; full Vitest green except the ONE pre-existing
  known-stale `SectionCard.test.tsx` AC-12 case (server/INSIGHTS.md's FIX-8
  entry — confirmed untouched via `git status`, unrelated to this session);
  `smoke.test.tsx` still passes. Server-side WI1-WI8 is `server/INSIGHTS.md`'s
  entry for the same date. New-test authorship for `PrBriefCard`/
  `BriefTimeline`/the `DiffViewer` focus overlay is `test-writer`'s job next,
  not attempted here beyond the pre-existing suites passing.

- 2026-08-14 (fix-loop iteration 1, `plan-verifier` Phase 3 required fixes):
  **the entry directly above was WRONG about `useGeneratePrBrief`'s
  `onSuccess`** — it actually called `qc.setQueryData(["pr-brief", prId],
  data)` unconditionally, for every mutation result including
  `budget_exceeded`/`failed` ones, whose `record` is always `null`. Since
  `usePrBrief()` reads that exact same cache key, a failed/budget-exceeded
  regenerate attempt silently overwrote a good, previously-persisted brief
  with `{state: 'failed', record: null}` in the read-cache — and because no
  `PrBriefCard` render branch matches `state === 'failed'`/`'budget_exceeded'`
  directly (only `absent`/`current`/`stale`/`corrupt` do), the card lost its
  Generate/Regenerate footer entirely with no way to recover short of a hard
  refresh (`providers.tsx`'s `staleTime: 30_000, refetchOnWindowFocus: false`
  meant it wouldn't even self-correct on next focus). **Fix**:
  `hooks/brief.ts`'s `onSuccess` now early-returns before `setQueryData` (and
  before the timeline invalidation) whenever `data.state` is
  `budget_exceeded`/`failed` — one guard covers both, cache and timeline
  fully untouched for those two states. `PrBriefCard`'s transient-outcome
  banner already read `generate.data` (the mutation's own state) rather than
  the read-cache, so no client component code needed to change for the read
  side — only the write. **Lesson**: a code comment or INSIGHTS.md entry
  asserting "X never happens" for a specific state-machine branch is not a
  substitute for grep-checking every `setQueryData`/cache-write call site
  against that same key — the assertion here was directionally right (the
  DESIGN intent was correct) but didn't match the actual code, and nothing
  caught it until `plan-verifier`'s Phase 3 traced the render-branch dead-end
  by hand. Also wired the 3 previously-dead `brief.json` i18n keys this bug
  surfaced (`card.retry`, `generate.lastCost`, `timeline.toggle`) into
  `PrBriefCard`'s transient banner (retry button + last-known-cost line, both
  reading the untouched `record` still in cache) and `BriefTimeline`'s
  disclosure summary.

- 2026-08-14 (same fix-loop iteration): **`SmartDiffViewer`'s per-file
  `openMap` (parent-owned) and `RoleGroup`'s per-group collapse state
  (previously a PRIVATE `useState` inside `RoleGroup`) must be owned by the
  SAME component, or nothing external can force-open a file inside a
  collapsed group.** `onJumpToLine`/`externalFocus` (AC-30 deep-link) only
  ever set `openMap[path]`, which controls whether `FileCard` renders
  *expanded* — but `RoleGroup` gated whether `<FileCard>` **mounted at all**
  behind its own `groupOpen` state, defaulting closed for the `boilerplate`
  role (`useState(() => role === "core" || role === "wiring")`) and for any
  group the user collapsed by hand. Result: a deep-link into a collapsed
  group's file found nothing in the DOM (`document.querySelector('[data-
  diff-line=...]')` came back null) and `scrollIntoView` silently no-op'd —
  no error, no visible failure, just nothing happening. **Fix**: lifted
  `groupOpenMap` (keyed by role) into `SmartDiffViewer` alongside `openMap`,
  same pattern (`initialGroupOpenMap`/`setGroupOpen`), and changed
  `RoleGroup` from owning `[groupOpen, setGroupOpen] = useState(...)` to
  accepting both as controlled props. `onJumpToLine` now resolves the
  target file's role via a `roleByPath` map and calls `setGroupOpen(role,
  true)` in the same tick as `setFileOpen(path, true)`, before the rAF×2
  scroll. **Test-authoring gotcha found while verifying the fix**: the
  `SmartDiffViewer.test.tsx` AC-30 boilerplate-group test asserts via
  `screen.findByText("{}")` (single match) — but `FileCard`'s own
  "What this does" summary-badge preview duplicates the exact diff-line text
  whenever a single-line patch's added content matches its own generated
  summary (here, `package-lock.json`'s one-line `+{}` patch). Both spans
  render once the file genuinely opens, so `findByText` throws "found
  multiple elements," not "not found" — this is the SAME duplicate-text
  class the sibling (already-passing) `AC-30: ...ALREADY-OPEN-GROUP (core)`
  test explicitly avoids by querying `document.querySelector('[data-diff-
  line="path:line"]')` instead of matching visible text. Flagged for
  `test-writer` to apply the same query pattern here rather than fixed
  inline (implementer's do-not-touch-test-files constraint) — the underlying
  architecture bug this test targets IS fixed and verified (failure mode
  changed from "element not found" to "multiple elements found," proving the
  group+file now mount correctly).

- 2026-08-22/23: Multi-Agent Review (SPEC-04/L07) client G3 — new
  `repos/[repoId]/multi-agent/` route (`MultiAgentPageView` orchestrates
  `?pr=`/`?run=` URL state → `ConfigureRunView` (subset picker, pure
  `computeSelectionEstimate`/`agentEstimateFor` helpers — sums cost, takes
  MAX duration, per WI11) or `MultiAgentResultsView` (Columns/Tabs toggle +
  `FindingGroupsSection` + `DisagreementSection`, always below either
  layout)); new `lib/hooks/multi-agent.ts`
  (`useAgentStats`/`useStartMultiAgentRun`/`useMultiAgentRun`/
  `useTurnIntoEvalCase` — the last two endpoints, `GET /agents/stats` and
  `POST /findings/:id/eval-case`, were built against G2's FIXED contract
  before G2's server routes existed, per the concurrent multi-agent split);
  added a `multi-agent` entry to `vendor/ui/nav.ts`'s WORKSPACE group (5th
  use of the sanctioned do-not-touch exception, icon `Users`, `gKey: "m"`)
  + a matching `SHORTCUTS` row — `activeKeyFor`/`shell.json`'s
  `nav["multi-agent"]` label were ALREADY pre-wired for this route before
  this session (same "pre-authored code anticipates the UX" pattern this
  file already documents), only the `NAV` array entry itself was missing.
  **Cross-route component reuse works via the `@/` alias despite bracket
  folder names**: `RunTraceDrawer` and `FindingCard` (both under
  `pulls/[number]/_components/`) are imported from the sibling
  `multi-agent/` route as `@/app/repos/[repoId]/pulls/[number]/_components/
  <Name>` — TypeScript/webpack resolve `[repoId]`/`[number]` as ordinary
  literal path segments, no dynamic-route/glob semantics apply to a static
  import specifier. Exactly ONE `openRunId` state + ONE `<RunTraceDrawer>`
  mount lives in `MultiAgentResultsView` (not per-column) — Columns'
  `AgentColumnCard` and Tabs' `AgentTabsView` both just call the SAME
  `onOpenTrace` callback passed down.
  **`AgentColumn` (observability.ts, G1-owned) has no dedicated `error`
  field** — unlike `RunSummary` (`trace.ts`), which does. `AgentColumnCard`
  treats `column.summary` as the error text when `status === 'failed'`
  (the field the server presumably repurposes on failure); flagged below
  for G1/a follow-up rather than guessed at silently, since I can't edit
  the do-not-touch contract file to add a real `error` field myself.
  **Reused `usePrReviews(prId)` (unmodified) as the enrichment source for
  BOTH the Tabs view's per-agent findings (filtered by `review.run_id`) and
  `FindingGroupsSection`'s per-member `FindingCard`s (looked up by finding
  `id` in a flat `Map`)** — `AgentColumnFinding`/`FindingGroupMember` (the
  lightweight projections `MultiAgentRun` actually carries) don't have every
  field `FindingCard` needs (no `accepted_at`/`dismissed_at`/full
  `category`/`file`/lines for members), but the SAME PR's `ReviewRecord[]`
  from the ordinary reviews endpoint already has full `FindingRecord`s for
  every run in the batch (each multi-agent run is an ordinary `agent_runs`
  row) — no server change needed, and accept/dismiss done anywhere
  (Tabs, a finding group) invalidates `["reviews", prId]` the normal way, so
  every other view showing the same finding id updates for free.
  `FindingGroupsSection/helpers.ts`'s `memberFindingRecord` falls back to
  reconstructing a projection-only record (accept/dismiss defaulted to
  unset) only for the rare case the reviews cache hasn't caught up yet.
  **"Show only conflicts" (WI13) toggle semantics had to be inferred, not
  read off a server contract** — `MultiAgentRun.conflicts` is, by its OWN
  doc comment, already filtered to genuine disagreements server-side (some
  agent flagged it and another didn't, OR severities diverge), so a
  client-side toggle can't mean "hide agreement rows" (there are none in
  this array). Implemented as: OFF (default) shows every row the server
  sent, including pure "some flagged it, others just didn't cover it" rows
  (`did not flag` is a first-class verdict, shown by default); ON narrows
  to `isSeverityDivergent` rows only — where the agents that DID flag it
  actively disagree on severity. Confirm this reading against G2's actual
  `conflicts[]` semantics once the server side lands; the pure helper
  (`DisagreementSection/helpers.ts`) is isolated and cheap to change if the
  real intent differs.
  **`Toggle` (`vendor/ui/primitives/Toggle.tsx`) takes `on`, not
  `checked`** — easy to guess wrong by analogy with `Checkbox`'s `checked`
  prop; caught by `tsc`, not by a runtime surprise, but worth remembering
  since this is the first place in the codebase this session that reached
  for `Toggle` instead of `Checkbox`.
  Verified: `tsc --noEmit` clean; full Vitest green (51 files / 280 tests,
  up from 51/... — 15 new self-check test files this session, one per
  colocated component/helpers pair, per this feature's plan explicitly
  requiring them). `smoke.test.tsx` (`/showcase`) still passes. No live
  browser click-through — G2 (server routes) and G4 (agent roster seed
  data) were running concurrently in the same working tree and hadn't
  landed yet, so there was nothing running to click through against.
  **Flagged, not resolved here**: (1) `AgentColumn`'s missing `error` field
  (above); (2) the "Show only conflicts" semantics need reconciling against
  G2's actual server-side `conflicts[]` computation once it lands; (3) no
  `nav.test.ts` assertion was added for the new `multi-agent` NAV entry
  (`onboarding-tour`'s precedent test file) — out of this session's file
  scope (`client/src/components/app-shell/nav.test.ts` was not in the
  assigned exclusive scope), left for a follow-up/test-writer pass.

- 2026-08-23: Multi-Agent Review (SPEC-04/L07) plan-verifier fix-loop
  iteration 1, client side (companion to the same-day server fix pass) —
  resolves all three items flagged above in the 2026-08-22/23 entry.
  **(1) `GET /agents/stats` field-name mismatch (Fix A, blocking)**:
  `lib/hooks/multi-agent.ts` was importing the WRONG shared contract —
  `@devdigest/shared`'s `AgentStats` (`runs`/`avg_latency_ms`/accept-rate/
  trend/…) is `GET /agents/:id/stats`'s richer per-agent-DETAIL shape, a
  different endpoint entirely; the actual `GET /agents/stats` response is
  the server's local, unvendored `AgentCostEstimate`
  (`server/src/modules/agents/helpers.ts`:
  `{agent_id, agent_name, avg_duration_ms, avg_cost_usd, sample_size}`).
  Because `lib/api.ts`'s fetch wrapper does zero runtime validation
  (`as T`), this never threw — every field silently read as `undefined`,
  so `agentEstimateFor`'s null-check always tripped and EVERY agent showed
  "no estimate yet" regardless of real history. Fixed by defining a local
  `AgentCostEstimate` interface in `lib/hooks/multi-agent.ts` (mirroring
  the server's shape field-for-field, exported for reuse) instead of
  importing the mismatched vendor type, and updating every consumer
  (`ConfigureRunView/helpers.ts`'s `agentEstimateFor`/
  `computeSelectionEstimate`, `AgentPickerCard.tsx`) to read
  `avg_duration_ms`/`sample_size` instead of `avg_latency_ms`/`runs`.
  **Lesson: a vendored contract with the exact right-looking field names
  for a DIFFERENT endpoint of the same resource is a worse trap than a
  missing type** — `AgentStats` type-checked cleanly against every call
  site because both interfaces exist and are structurally plausible;
  `lib/api.ts`'s zero-runtime-validation `as T` cast means nothing catches
  this until manual field-by-field comparison against the actual server
  response. Always trace a hook's response type back to the server
  handler/service that actually implements the route, not just to a
  same-named export.
  **(2) `AgentColumn.error` not rendered for `failed`/`cancelled` (Fix B,
  Major)**: the server added a real `error: z.string().nullish()` field
  (populated for `status === 'failed' | 'cancelled'` only); `AgentColumn`
  had none before (see the 2026-08-22/23 entry's flag). `AgentColumnCard.tsx`
  now branches on `status === 'failed' || status === 'cancelled'` (was
  `'failed'` only) and reads `column.error` (was `column.summary`, which
  the server no longer overloads for this — it only ever carries a genuine
  review summary now).
  **(3) "Show only conflicts" toggle didn't implement AC-30 (Fix C,
  blocking)**: the 2026-08-22/23 entry's `isSeverityDivergent`-only ON
  filter was too narrow — it never treated a silent/`'ignored'` take as a
  conflict on its own, only severity divergence among non-ignored takes.
  The server-side prerequisite for a correct OFF state also landed this
  same fix pass: `conflicts[]` now emits EVERY shared location unfiltered
  (previously pre-filtered server-side to only AC-30 matches, so OFF could
  never actually show a non-conflicting row — there were none to show).
  `DisagreementSection/helpers.ts` renamed `isSeverityDivergent` →
  `isConflict` and implemented AC-30's real OR-definition: `hasSilentParticipant
  (conflict) || hasSeverityDivergence(conflict)` — either alone is
  sufficient, they are not required together. **Test fixture gotcha**: the
  pre-existing `DisagreementSection.test.tsx` "toggle narrows" test used a
  fixture with one flagged + one ignored take and asserted that toggling ON
  HID it — that assertion was itself encoding the old, wrong semantics (a
  silent participant now correctly counts as a conflict, so ON must KEEP
  it). Replaced with two fixtures: the original (flagged + ignored) to
  prove ON now keeps a silent-participant row, and a new all-agree fixture
  (every agent flagged it, all same severity) to prove ON still correctly
  excludes genuine non-conflicts. Same fixture-encoded-the-bug gotcha in
  `AgentColumnCard.test.tsx`'s "status is never color-only" test — with
  `error: null`, both the status chip AND the error box's status-key
  fallback render the literal text "Cancelled", so `getByText` throws
  "multiple elements found"; switched to `getAllByText(...).length >
  0` since the test only cares that SOME text label renders, not the count.
  Verified: `tsc --noEmit` clean; full Vitest green (51 files / 284 tests,
  up from 51/280 — 4 new test cases across the three fixed helpers/
  components, no new test files). `smoke.test.tsx` still passes.

- 2026-08-23: Multi-Agent Review, user-driven design-parity + scope pass
  (three separate user-reported mismatches against mockup screenshots, all
  in `repos/[repoId]/multi-agent/` and `pulls/[number]/_components/
  RunReviewDropdown/`).
  **(1) `ConfigureRunView` rendered the FULL agent checkbox list (all
  pre-checked) even before a PR was picked** — the mockup gates "2 Agents to
  run" behind an `EmptyState` placeholder ("Pick a pull request first") until
  `prId` is set; the old code only guarded the "Select all" button's
  visibility, never the list itself, and the seeding `useEffect` for
  `defaultSelectedAgentIds` ran regardless of `prId` too (harmless — it just
  seeds state, the list wasn't rendered to show it). Fixed by wrapping the
  step-2 body in `prId ? agents.map(...) : <EmptyState .../>`; the redundant
  "Select a PR to begin." hint UNDER the PR selector was also dropped since
  the new placeholder body says the same thing (`runs.json` `page.noRun.*`
  keys are now fully dead — left alone, not this session's cleanup scope).
  **(2) A SECOND mockup screenshot (checkbox agent-picker inside the PR
  page's `Run Review` dropdown) directly contradicted `specs/
  SPEC-04-multi-agent-review.md`'s own recorded boundary** ("Not a
  replacement for `RunReviewDropdown`. Single-agent and 'run all' stay
  exactly as they are.", AC-8). Confirmed with the user this was an
  intentional override, not a missed requirement — do NOT silently implement
  a mockup that contradicts a written spec boundary without flagging the
  conflict first. Amended the spec in place (new AC-8a) rather than leaving
  it contradicted by the shipped code — a spec is a decision record; an
  overridden decision needs a new dated note, not silent drift between doc
  and code.
  **The vendored `Dropdown` primitive (`src/vendor/ui/kit/Dropdown.tsx`,
  do-not-touch) cannot host this pattern at all** — every `DropdownItem`
  click calls `onClose()` unconditionally after `onClick`, and its body only
  accepts a flat `DropdownItemDef[]`, not arbitrary children, so a checkbox
  section that must survive N clicks before one final submit has no home
  inside it. `RunReviewDropdown.tsx` now builds its OWN small popover
  (own `open` state + its own mousedown-outside-listener effect, copied
  verbatim from `Dropdown.tsx`'s technique since it can't be imported/
  extended) with hand-written `ActionRow` rows replicating `DropdownItem`'s
  exact visual spec (padding `8px 10px`, `borderRadius:6`, hover
  `var(--bg-hover)`) to stay pixel-identical to the primitive it replaced.
  This is now this codebase's second local reimplementation of a
  vendor-primitive-shaped popover for a case the vendored version can't
  cover — see the existing `components/popover/Popover.tsx` entry above
  (hover-triggered vs. this one's click-triggered-with-a-form-inside);
  worth promoting BOTH into a real shared non-vendor primitive
  (`components/dropdown-panel/`?) if a third case shows up.
  New picker section defaults to every ENABLED agent (same default as
  `ConfigureRunView`), has its own "Clear", and its primary button starts a
  batch via `useStartMultiAgentRun` + navigates straight to
  `/repos/:repoId/multi-agent?run=:id` — same destination `PrDetailHeader`'s
  separate "Multi-Agent Review" button already used, just skipping the
  configure screen. Old items ("Run all enabled agents", per-agent
  single-run rows, "Configure agents…") are untouched, rendered below a
  divider.
  **(3) Per-agent accent color only covered 4 named personas** (Security/
  Performance/Junior Mentor/Customer-Facing) + a special-cased Architecture
  gray; every other agent (including two identically-named "Smoke Test
  Agent!!" seed rows) rendered on the plain default border, and any NEW
  agent created later would too. `agent-visuals.ts`'s `agentVisual` signature
  changed from `(agentName)` to `(agentId, agentName)` (three call sites
  updated: `AgentPickerCard`, `AgentColumnCard`, `AgentTabsView`'s tab bar) —
  needed `agentId` specifically because two agents can share a display name,
  and hashing the name would force them to the same color. Unmapped agents
  (Architecture included — it keeps its `Layers` icon via a separate
  `ICON_OVERRIDES` map but no longer gets a reserved color) now get one of 4
  new hues via a stable FNV-1a hash of their id mod palette length; the
  do-not-touch vendored token set (`vendor/ui/styles.css`) has no spare hues
  left (already documented in this file's own prior comment history), so the
  4 new colors are new theme-aware CSS vars (`--agent-aqua/yellow/magenta/
  violet`) added to `client/src/app/globals.css` (NOT vendor — that file is
  the app's own stylesheet, already used for `@font-face`/keyframes, and is
  the correct place to layer app-specific tokens on top of do-not-touch
  design-system tokens).
  **Used the `dataviz` skill's `validate_palette.js` for a NON-chart,
  per-entity identity-color use case** (card border + icon tint, not a chart
  series) — first use of that validator outside an actual chart in this
  codebase. Ran it against this app's real surfaces (`--surface #141414
  --mode dark`, `--surface #fafafa --mode light`, not the skill's own
  default reference surfaces) with candidate hex sets. Mixing the app's
  EXISTING severity hexes (`--crit`/`--warn`/`--sugg`/`--ok`) with the
  `dataviz` reference palette's same-named slots (blue/orange/green/red) at
  8-wide FAILED hard (lightness band + CVD + normal-vision floor all failed
  under `--pairs all`) — the two palettes were never validated together and
  don't mix safely. Settled on keeping the 4 existing severity hexes
  untouched and adding a SEPARATE, smaller 4-hue subset (aqua/yellow/
  magenta/violet, `--pairs adjacent` PASS in both themes; `--pairs all`
  fails one deutan pair at ΔE 1.6, accepted per the skill's own stated
  exception since every card already pairs color with an icon + the agent's
  name — color is never the sole identifier here). Light mode also carries a
  contrast WARN (3 of the 4 hues sub-3:1 on `#fafafa`) mitigated the same
  way. Lesson for next time: when reusing `dataviz`'s reference palette
  alongside a design system's own PRE-EXISTING, differently-valued semantic
  hex colors, validate the ACTUAL combined set you intend to ship, never
  assume the reference palette's own documented adjacent-pair pass transfers
  to a mixed set with different hex values at the same slots.
  Verified: `tsc --noEmit` clean; full client Vitest green (52 files / 293
  tests, up from 51/284 — 2 new test files: `agent-visuals.test.ts`,
  updated `RunReviewDropdown.test.tsx` + `ConfigureRunView.test.tsx`). No
  live browser click-through this session (same no-browser-automation gap
  noted elsewhere in this file for past sessions, though `agent-browser` was
  reportedly installed in 2026-08-02 — not re-verified working here).

- 2026-08-23 (same day, follow-up): **per-agent hash-mod color assignment
  (above) produced a visible bug the very first time the roster exceeded 4
  unmapped agents — 3 of 6 unmapped agents (Architecture + both seeded
  "Smoke Test Agent!!" rows) landed on the SAME violet by chance**, reported
  by the user from a live screenshot. Independent `hash(id) % 4` per agent
  is only *expected* to spread evenly; for any given small set of ids it can
  (and did) cluster — pigeonhole guarantees nothing about the actual split.
  **Fixed by switching from independent hashing to ROUND-ROBIN over the
  whole roster**: `agent-visuals.ts`'s public API changed from a per-agent
  `agentVisual(id, name)` to `agentVisuals(agents[]): Map<id, AgentVisual>`
  (call once per screen with its full agent list) + `agentVisualFrom(map,
  id)` (safe lookup with a fallback, never throws on a miss). Internally:
  named personas resolve first, then the REMAINING unmapped agents are
  sorted by id (stable regardless of API fetch order) and assigned
  `AUTO_PALETTE[index % 4]` by their position in that sorted list — this
  guarantees no auto color is used more than `⌈n/4⌉` times for whatever
  roster size is passed in, which independent hashing cannot guarantee at
  any n. **This requires the full roster at the assignment call site, not
  just the one agent being rendered** — threaded through as a new required
  `visual: AgentVisual` prop on `AgentPickerCard` and `AgentColumnCard`
  (computed once via `useMemo` in their respective parents,
  `ConfigureRunView` and `MultiAgentResultsView`, from data those parents
  already had — `agents` and `run.columns`), while `AgentTabsView` and
  `RunReviewDropdown` compute the map internally since they already receive
  the whole roster as their own prop. **General lesson: per-item
  independent hashing into a small fixed palette is the wrong tool whenever
  the caller can see the whole collection at once and low-cardinality
  "spread evenly" is the actual requirement** — reach for a stable-sorted
  round-robin/index assignment instead; hashing only becomes necessary when
  you must color a single item with no visibility into its siblings (not the
  case for any of Multi-Agent Review's rosters, all of which are small and
  fully in hand at render time). Verified: `tsc --noEmit` clean; full client
  Vitest green (52 files / 295 tests, up from 52/293 — `agent-visuals.test.ts`
  rewritten against the new API including a fairness assertion: 6 unmapped
  agents into 4 slots, no slot used more than twice).

- 2026-08-23 (same day, second follow-up): **the round-robin fix (above)
  eliminated the exact-duplicate bug but the underlying 4-hue AUTO_PALETTE
  was ALSO independently broken — a user screenshot showed General
  Reviewer/Test Quality Reviewer/API Contract Reviewer/Architecture each
  visually reading as the SAME color as an unrelated NAMED persona**
  (General ≈ Performance's orange, Test Quality ≈ Junior Mentor's blue, API
  Contract/Architecture ≈ Customer-Facing's green) — a hue-collision bug,
  not a distribution bug, so round-robin alone couldn't fix it. Root cause:
  the 4 auto hues (aqua/yellow/magenta/violet) were lifted directly from
  `dataviz`'s reference 8-hue categorical palette's "other 4" slots, which
  are only validated as safe *relative to that palette's own* blue/orange/
  green/red hex values — this app's `--crit`/`--warn`/`--sugg`/`--ok` are
  DIFFERENT hex values at those same hue families, so the "safe" spacing
  didn't transfer. **Root-caused with the actual validator, not eyeballing**:
  ran `validate_palette.js` with THIS app's real reserved four
  (`#ef4444,#f59e0b,#3b82f6,#10b981`) plus each auto-candidate, `--pairs
  all`, against the real surfaces — confirmed aqua/yellow both hard-FAIL the
  "normal-vision floor ≥15" gate against their nearest reserved neighbor
  (not just the softer 6-8 CVD warn band the icon+label mitigation already
  covers). Systematically hue-mapped this app's 4 reserved colors onto the
  0-360° wheel (red≈0°, warn≈38°, ok≈160°, sugg≈217°) to find open gaps,
  and learned the empirical lesson the hard way: **hue-angle distance on
  paper does NOT predict OKLab ΔE distance** — a "yellow-green"/lime
  candidate placed dead-center in the visually-spacious 122°-wide warn→ok
  gap still hard-failed against BOTH neighbors (yellow-green is a known weak
  spot in human hue discrimination), and a cyan candidate centered in the
  57°-wide ok→sugg gap failed against sugg specifically. **Only the wide
  143°-wide sugg→red arc had room for genuinely safe colors, and only for
  TWO** (`#7c3aed` violet, `#b3159c` magenta/dark; `#6d28d9`/`#8a1177`
  light) — every 3rd/4th candidate tried in that same arc (indigo, brighter
  pink, deeper rose) collided with violet or magenta once packed in tighter.
  **AUTO_PALETTE is now 2 entries, not 4** (`agent-visuals.ts`,
  `globals.css`'s `--agent-violet`/`--agent-magenta` — `--agent-aqua`/
  `--agent-yellow` deleted). To compensate for fewer colors, added a
  SEPARATE `AUTO_ICONS` round-robin (8 icons — Cpu/Wrench/Search/
  FlaskConical/Boxes/Target/Bug/Database, all previously-unused in this
  file) at a DIFFERENT modulus than the 2-color palette, confirmed by the
  user as the preferred tradeoff over "free up a reserved color" or "fewer
  slots, more collisions" — two agents can share a color but not an icon
  until the roster exceeds 8 unmapped agents. **General lesson: when
  reusing ANY reference categorical palette (this app's own past attempt
  included) alongside a design system's PRE-EXISTING, independently-chosen
  hex values for the "taken" hue families, always validate the actual
  combined 8-ish-color set with `--pairs all` against the real surfaces
  before shipping — a reference palette's internal hue math offers zero
  guarantee once even one of its slots is swapped for an unrelated hex.**
  Verified: `tsc --noEmit` clean; full client Vitest green (52 files / 296
  tests, up from 52/295 — one new assertion: 6 unmapped agents get 6
  distinct icons even though only 2 distinct colors exist among them).
- 2026-08-21: L06 Eval Pipeline client side (Phase D,
  `docs/plans/eval-pipeline.md` WI9-WI13; server Phases A-C already shipped).
  New `lib/hooks/eval.ts` (the plan's 12 named hooks plus `useEvalBatch`/
  `useEvalBatches`, added for a real gap — see the new Codebase Patterns
  entry above) and `lib/types.ts` re-exports; new `eval.compare.*`/
  `eval.dashboard.na`/`naReason`/`relativeScoresNote`/`runAllAgents*` i18n
  plus `prReview.finding.turnIntoEvalCase`/`evalCaseCreatedMustFind`/
  `evalCaseCreatedMustNotFlag` — deliberately minimal, following AC-41's
  enumerated new-key list; several other UX requirements (version badges,
  skills-fingerprint caveat, "first run" label, per-case cost estimate
  captions) were rendered as plain hardcoded English strings instead of new
  i18n keys, the same established precedent this file already documents for
  incidental copy (e.g. the hardcoded "Skills Lab"/"Agents" breadcrumb
  literals in `agents/[id]/page.tsx`). `FindingCard` gained a third
  action button ("Turn into eval case", `onCreateEvalCase` prop, separate
  from `onAction`'s `FindingActionKind` union so the shared contract stayed
  untouched), shown only when `accepted || dismissed`; `FindingsPanel` wires
  it to `useCreateEvalCaseFromFinding` + a toast confirming which
  expectation kind was created (UX-2). Agent Editor gained an `evals` tab
  (`AgentEditor/_components/EvalsTab/`, metrics + case list +
  `CaseEditorModal` with a live `EvalExpectation.safeParse` validity badge)
  — `constants.ts`'s `TABS`/derived `TAB_KEYS` needed only one array entry,
  confirming the 2026-08-13 `TAB_KEYS`-must-be-derived fix (entry above)
  still holds. New `/evals` route (`EvalDashboardView` master list →
  `AgentEvalDetail` per-agent trend/history/compare-picker →
  `EvalCompareView` read-only diff) added to `nav.ts`'s SKILLS LAB group
  (the sanctioned vendor exception, used again) — this ALSO required fixing
  `activeKeyFor` (see the new Recurring Errors & Fixes entry above), which
  is easy to miss since the page still renders fine without it, just with a
  permanently-unhighlighted sidebar item. `LineChart` is passed explicit
  `yMin={0} yMax={1}` per AC-39/E-7 (and see the new zero-fill quirk noted
  in Tool & Library Notes). An EXISTING test file broke from this session's
  change, not just needed new coverage: `FindingsPanel.test.tsx`'s `vi.mock`
  for `lib/hooks/reviews` had no equivalent for the newly-added
  `useCreateEvalCaseFromFinding` call, so the real hook ran and threw "No
  QueryClient set" — fixed by extending the mock, same "a new child hook
  call breaks an existing test's mock scaffolding" lesson this file already
  recorded for SPEC-01 (2026-08-13 entry above). Verified: `tsc --noEmit`
  clean; full Vitest green (38 files / 228 tests, once the `FindingsPanel`
  mock fix above landed); zero ad-hoc `fetch(` in any new file
  (grep-confirmed). New-test authorship for `EvalsTab`/`CaseEditorModal`/
  `CaseRow`/`EvalDashboardView`/`AgentEvalDetail`/`EvalCompareView`/the
  `FindingCard` third-button behavior is `test-writer`'s job next, not
  attempted here beyond the pre-existing suites passing.

- 2026-08-22: L06 Eval Pipeline, Phase D plan-verifier fix-loop iteration 1.
  **A `@devdigest/shared` VALUE import (not `import type`) breaks Next's
  webpack bundler even though `tsc --noEmit` and Vitest both stay green —
  and it takes down every route that reaches it, not just the one that
  imports it.** `CaseEditorModal.tsx` had `import { EvalExpectation } from
  "@devdigest/shared"` (a runtime `.safeParse()` call, not just a type) —
  the only non-`import type` client usage of the barrel in this codebase.
  `client/src/vendor/shared/index.ts` re-exports via relative `./contracts/
  *.js` specifiers pointing at `.ts` source files (the NodeNext convention —
  `tsc`'s `moduleResolution: "Bundler"` and Vitest's Vite alias both resolve
  this natively). Next's webpack does NOT, by default: `next dev` 500'd on
  EVERY tab of `/agents/:id` (not just Evals — any route whose module graph
  reaches the barrel at runtime), and `next build` failed with `Module not
  found: Can't resolve './contracts/*.js'`. **Verified the narrower-looking
  fix does NOT work**: importing the specific contract file directly
  (`@devdigest/shared/contracts/eval-ci`, bypassing the barrel) still fails,
  because `eval-ci.ts` itself has its own relative `.js` imports (`./
  findings.js`, `./knowledge.js`) for schemas it genuinely uses at runtime
  (`Verdict.default(...)`, `EvalOwnerKind` in a field type) — the `.js`→
  `.ts` mismatch is a property of ANY relative import in `vendor/shared`,
  not something scoped to the barrel file. The actual fix: `next.config.mjs`
  gets a `webpack: (config) => { config.resolve.extensionAlias = { ...,
  ".js": [".ts", ".tsx", ".js"] }; return config; }` — this is the ONE
  non-vendor file allowed to touch this, and it makes the barrel (and any
  contract file) safely value-importable everywhere going forward, not just
  at this one call site. Confirmed live, not just via `tsc`/`vitest`
  (plan-verifier explicitly flagged those as blind to this class of break):
  `next dev` serving `/agents/:id?tab=evals` (and `config`, `/evals`, `/`)
  all 200 before AND after adding the alias would be the wrong test — the
  500 only reproduces via `next build`'s webpack pass or a `next dev` route
  that hasn't been compiled yet in that dev session; a stale `.next` cache
  can hide it. Always verify a webpack-resolution fix with a fresh `next
  build` (exit code, not just skimming for "Compiled successfully"), not
  `tsc --noEmit` alone.
- 2026-08-22 (same session): **`dashboard.current.recall/precision/
  citation_accuracy` (both `AgentEvalDetail` and `EvalsTab`) are sourced
  server-side from `recent_runs[0]` (the LATEST batch), not aggregated
  across the owner's whole case history** — see `server/src/modules/eval/
  service.ts`'s `buildDashboard`: `current = { recall: latest?.recall, ... }`
  where `latest = batches[0]`. So that SAME batch's own `recall_cases`/
  `precision_cases`/`citation_cases`/`cases_total` (already on
  `EvalBatchRecord`, already present in `dashboard.recent_runs[0]` — no new
  endpoint needed) are the correct per-metric contributing-case caption for
  AC-30/UX-5, NOT `dashboard.cases_total` (the owner's whole case set,
  which is deliberately a different, larger number and would misrepresent
  "17 of 8 cases" as "17 of 20"). `MetricCard` (`vendor/ui/charts/
  MetricCard.tsx`) has no caption/subtitle prop and is do-not-touch vendor
  code — render the caption as a sibling `<p>` inside the existing
  `metricWrap` flex column instead of extending the component.
- 2026-08-22 (same session): a pre-existing i18n typo (`shell.nav.evals` —
  `useShellCommands.ts` builds `t(`nav.${it.key}`)` from `nav.ts`'s item key
  `"evals"`, but `messages/en/shell.json`'s `nav` block only has the
  singular `eval`) fires as a caught `MISSING_MESSAGE` console error on
  EVERY route (confirmed via live `next dev` log, including `/`) — it does
  NOT fail the request (still 200) and is unrelated to any work this session
  touched. Left alone (out of scope for this fix-loop's required items); if
  picked up later, the fix is either renaming `messages/en/shell.json`'s
  `nav.eval` → `nav.evals` or the reverse in `nav.ts`, not touching
  `useShellCommands.ts`.
- 2026-08-22 (same session): an "enumerated new-keys" inventory test
  (`src/i18n/eval-l06-keys.test.ts`, AC-41) asserts the FULL exact list of
  new `eval.json` keys added since a captured pre-Phase-D baseline — adding
  any new key anywhere in that file, even a deliberately spec-justified one
  from a later fix-loop, fails this test until the new key is added to its
  `expectedNewKeys` array too. This is correct/expected behavior for this
  test's design, not a test to route around: when a fix instruction says
  "note this addition plainly, it falls outside the original enumerated
  list," that plainly-noted addition belongs BOTH in a code comment near the
  new key's usage AND as an explicit, commented addition to this test's
  expected-list array (see `dashboard.metricCasesCaption`'s entry there) —
  don't leave the test failing or weaken its exact-match assertion into a
  subset check.
- 2026-08-22 (fix-loop iteration 2, same Phase D session): the deferred
  `shell.nav.evals` i18n mismatch noted above turned out to be
  build-breaking, not just a caught console error — `next build`'s static
  generation for `/evals` and `/agents/[id]` fails outright with `Error:
  MISSING_MESSAGE: shell.nav.evals (en)` (plan-verifier caught this;
  `next dev`'s earlier "still 200" observation was misleading — it only
  held for ALREADY-COMPILED dev routes, not a fresh `next build` pass).
  Fixed by renaming `messages/en/shell.json`'s `nav.eval` → `nav.evals`
  (confirmed dead otherwise — grepped for any other `nav.eval` reference
  before renaming rather than adding a second key). Added two regression
  layers: a static key-diff test (`components/app-shell/nav.test.ts`) and a
  real-`next-intl`-runtime hook test
  (`components/app-shell/hooks/useShellCommands.test.tsx`) — see the Tool &
  Library Notes entry above for why the static test alone doesn't prove the
  runtime behavior. Also closed two required-fix items from the same
  review round: added a contributing-case-count regression test per
  component (`AgentEvalDetail.test.tsx`, `EvalsTab.test.tsx`, asserting
  each metric tile's caption reads its OWN `*_cases` field, not
  `cases_total` or another metric's count) and a
  response-vs-timestamp-contradiction test in `FindingsPanel.test.tsx`
  (pins that the "Turn into eval case" confirmation follows the mutation's
  own response, not a client-side re-derivation from `accepted_at`/
  `dismissed_at`).

- 2026-08-23: Export to CI, Phase D client build (`docs/plans/spec-04-export-to-ci.md`
  WI17-WI20; Phases A-C were server-only, already committed). New
  `lib/hooks/ci.ts` (`useCiPreview` a mutation, never a query — AC-46;
  `useCiExport`, `useCiExportZip`, `useAgentCiInstallations`, `useCiRuns`,
  `useDeleteCiInstallation`) + CI contract re-exports in `lib/types.ts`. New
  agent-editor `CiTab` (`AgentEditor/_components/CiTab/`) — installation
  list with last-run/never-ran + drift banner, `Fail CI on` wired through
  the existing `useUpdateAgent`, Update/Remove — and the four-step
  `ExportWizard` (`_components/ExportWizard/`, Target → Preview → Configure
  → Install) reachable from it. Corrected `ci.json`'s
  `exportWizard.blockMergeDesc` (no longer claims a GitHub App is needed to
  block merges) and `runs.emptyBody` (now points at the connection/secrets
  requirement, not "just export it"); added every new key WI17 named,
  touched no other existing key. See Codebase Patterns / Tool & Library
  Notes above for the vendored `ExportWizardSteps` reuse, the shared
  `WizardState`/`buildExportInput` design, the new `api.postBlob`, and the
  shared-machine `:3001` port-ownership gotcha this session hit while
  live-verifying Preview/Zip against a throwaway server instance on
  `:3011`. Did not attempt a real Install (GitHub PR write) — no
  `GITHUB_TOKEN` configured for the throwaway instance, same precedent as
  Phase C's own session (`server/INSIGHTS.md` 2026-08-23 entry). No new
  tests authored this pass (explicit user decision, `test-writer` runs
  separately); `tsc --noEmit` clean and the full existing Vitest suite (45
  files / 276 tests, including `AgentEditor.test.tsx`) passed unchanged.

- 2026-08-23: Export to CI, Phase E — final phase (`docs/plans/spec-04-export-to-ci.md`
  WI21-WI23). New `/ci-runs` page (`app/ci-runs/page.tsx` +
  `_components/CiRunsView/`): one `useCiRuns({ since_days })` fetch per
  page, scoped server-side only by the time-window filter; the other four
  filters (agent/repo/status/source) narrow that SAME result set
  client-side (`helpers.ts` `applyFilters`) rather than issuing a second
  server round-trip per filter change — the agent/repo/source dropdown
  option lists are also derived from that one fetched set
  (`distinctAgentOptions`/`distinctRepoOptions`/`distinctSourceOptions`),
  so picking one filter never shrinks another filter's own option list.
  Findings column has three explicit states (`findingsDisplay`:
  `"split"` when any of critical/warning/suggestion is non-null,
  `"total"` falling back to `findings_count` when all three are null,
  `"unknown"` rendering a dash when even the total is null) — this is the
  concrete shape of AC-64/AC-66's "never render a 0 for a severity you
  don't know" rule; a null field is OMITTED from the split render, never
  coerced to 0. `source` renders `run.source` verbatim with zero validation
  against `CiTarget` (D-13) — confirmed by reading the contract
  (`CiRun.source: z.string().nullable()`, no enum) and writing
  `sourceLabel()` as a straight passthrough with no branch on the value.
  Nav entry added to `vendor/ui/nav.ts` (`key: "ci-runs"`, SKILLS LAB
  group, `gKey: "i"` — confirmed free by reading the live `SHORTCUTS`
  array first, not by trusting the plan's claim) — this is the one
  sanctioned do-not-touch exception for this plan, purely additive, no
  neighboring entry touched. Hit the exact SAME shared-machine port
  gotcha the Phase D entry above documents: both `:3000` and `:3001` on
  this machine belong to a `D:\htdocs\devDigest` checkout, not this
  worktree (confirmed via `wmic process ... get CommandLine`), so a
  live-against-`pnpm dev` check for `/ci-runs` was not attempted this
  session — verified instead via `tsc --noEmit` (clean) and the full
  existing Vitest suite (45 files / 276 tests, including `nav.test.ts`'s
  9 tests and `smoke.test.tsx`) passing unchanged. No new tests authored
  this pass (explicit scope: no `test-writer` stage). Also ran the
  server-side WI23 sweep from this same session: `tsc --noEmit` and
  `depcruise` both clean on `server/`; `git diff --no-index` between the
  two `eval-ci.ts` vendor mirrors printed nothing; a literal
  `grep -rn "process.env" server/src/modules/ci/` still matches 2 lines,
  but both are doc-comments (one describing the GENERATED CI runner's own
  env usage, one asserting `service.ts` itself has zero such reads) —
  not actual code, and pre-existing from Phases C/D, not from this
  session's changes.

- **Correction to the 2026-08-22/23 "Multi-Agent Review" entry above: the
  `multi-agent` NAV entry landed in the GLOBAL group, not WORKSPACE
  (confirmed 2026-08-27, SPEC-06 WI13).** That entry's own text says "added a
  `multi-agent` entry to `vendor/ui/nav.ts`'s WORKSPACE group (5th use...)" —
  reading `src/vendor/ui/nav.ts` directly (lines ~70-81 as of this session)
  shows it's actually in the `GLOBAL` section, alongside nothing else until
  this session added `agent-performance` as its second member. Per this
  file's append-only rule the original entry is left as written, not edited
  — code is ground truth over a prior session's own narrative when the two
  disagree (this was also the SPEC-06 Development Plan's own flagged risk,
  now resolved). If a future session needs "which group is the multi-agent
  nav item in" for a similar do-not-touch-exception precedent, trust
  `nav.ts` itself, not this file's 2026-08-22/23 wording.

- 2026-08-27: SPEC-06 Agent Performance dashboard, Phases C+D (client) —
  the per-agent Stats tab (`AgentEditor/_components/StatsTab/`, new
  `useAgentDetailStats` hook in `lib/hooks/agents.ts`) and the workspace-wide
  `/agent-performance` dashboard (`AgentPerformanceView/`, new `useAgentPerf`
  hook in the new `lib/hooks/agent-performance.ts`) — both range-scoped via
  a new shared `lib/hooks/range.ts` (`RangeQuery` type, query-key/query-string
  builders, and `rangeFromSearchParams` for reading `?range=&start=&end=`
  off the URL) and a new shared `components/range-selector/RangeSelector.tsx`
  (1d/30d/custom picker — a new reusable primitive, so per this file's
  existing convention it lives in `components/`, not `src/vendor/ui/**`).
  **Named the new hook `useAgentDetailStats`, deliberately NOT
  `useAgentStats`** — that name was already taken by `lib/hooks/multi-agent.ts`
  for the different `GET /agents/stats` endpoint (see the 2026-08-23 entry
  above, "`GET /agents/stats` field-name mismatch") — reusing it would have
  been a barrel collision AND exactly that entry's own trap in hook-name
  form, now with a THIRD similarly-shaped type live at once
  (`AgentCostEstimate`/`AgentStats`/`AgentPerfRow`). Both new hooks carry an
  explicit comment tracing their response type to the exact server handler
  that produces it, per that same lesson.
  Nav: added `agent-performance` to `nav.ts`'s `GLOBAL` group (see the
  correction entry above) with `gKey: "f"`, icon `BarChart`, no `:repoId`
  token — both were confirmed unused via grep before use, and
  `activeKeyFor`/`shell.json`'s `nav["agent-performance"]` label were
  ALREADY pre-wired before this session (same "pre-authored code anticipates
  the UX" pattern this file documents repeatedly) — only the `NAV` array
  entry and `nav.test.ts` coverage were actually missing. Extended
  `nav.test.ts` with a dedicated describe block (group/href/gKey/icon
  collision checks + `activeKeyFor` highlighting `/agents/:id` as `"agents"`,
  not `"agent-performance"` — confirmed the two prefixes never collide since
  the 7th character differs, `s` vs `-`).
  Verified: `tsc --noEmit` clean; full Vitest 63 files / 368 tests, all
  green, including `nav.test.ts`'s new block (13/13) and `smoke.test.tsx`
  (`/showcase` mounts fine — no broken component export). Also did a live
  end-to-end check against the real `pnpm dev` server this session (see
  `server/INSIGHTS.md`'s matching entry) — confirmed `GET
  /agents/:id/stats`/`GET /agents/performance` actually return the shapes
  these hooks assume, not just that they typecheck against the vendored
  contract (the exact E-1 gap this file's 2026-08-23 entry warns "nothing in
  this plan changes" — still true generally, but this session's specific
  hooks were checked against a live response at least once).

- 2026-08-28: SPEC-06 fix-loop iteration 1 — addressed plan-verifier's A2
  (custom-range validation UX) and 4 live design-fidelity gaps the user found
  by using the running app (C1-C4): the low-confidence group's table now
  repeats the SAME `<thead>` as the ranked table above it (one coherent
  table with a group separator, not two visually different ones); the Total
  Runs tile gets a `Sparkline` fed by a new `AgentPerf.summary.runs_trend`
  field (server-computed total run count per bucket — deliberately NOT
  derived from `AgentPerfRow.trend`, which is findings-per-run, a different
  metric); the per-agent table's Agent column reuses `AgentCard`'s own
  icon-box pattern (`Icon.Cpu` in a small colored badge) rather than
  inventing a new per-agent icon system (the mockup's shield/lightning/pin
  icons have no precedent anywhere in this codebase, including in
  `AgentCard` itself — confirmed by reading it); the Accept column is now
  color-coded by threshold (`var(--ok)`/`var(--warn)`/`var(--crit)` — the
  same tokens `MetricCard`'s delta indicator already uses) — the mockup's
  ↑/↓ trend arrow was scoped OUT: `AgentPerfRow` carries no accept-rate-
  over-time series (only a findings-per-run `trend`), so a real directional
  arrow would need a new field; threshold-only coloring was treated as an
  acceptable partial fix per the fix-loop's own instruction. Also fixed a
  real, user-reported RangeSelector bug (both new Tool & Library Notes
  entries above) discovered to be the root cause of BOTH a "calendar icon
  does nothing" report AND a "can't finish typing a full date" report — one
  fix (local input state, decoupled from the router-synced prop) resolved
  both. Verified: `tsc --noEmit` clean; full Vitest 66 files / 382 tests, all
  green (including `AgentPerformanceView.test.tsx`, `StatsTab.test.tsx`,
  `nav.test.ts`, `smoke.test.tsx`); live-checked against the real `pnpm dev`
  server (already running, picked up every change via file-watch/HMR) —
  `GET /agents/performance` returns a real `runs_trend` array and the
  correct 422 for an incomplete custom range against actual dev-DB data. No
  dedicated browser/screenshot tool available in this session to visually
  re-confirm C1-C4 pixel-for-pixel against the mockup — recommend the
  orchestrator's live smoke-check phase do that pass.
