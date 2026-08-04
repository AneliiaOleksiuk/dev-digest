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
  necessary twice now (Skills nav entry 2026-08-02, session below; the
  Conventions nav entry the same day): without an entry here, a new
  top-level route is only reachable by typing the URL directly — the
  sidebar has no link to it, and `activeKeyFor` in
  `components/app-shell/helpers.ts` (already pre-wired for
  `pathname.includes("/conventions")` before this session even added the
  page) has nothing to highlight. Flag this exception to whoever's
  reviewing before editing it, don't silently treat "do-not-touch" as
  covering it.
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

_(to be filled in)_

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

## Open Questions

- **Smart Diff (Core logic / Wiring / Boilerplate grouping + per-file "what
  this does" AI summary) is unwired scaffolding, not a built feature.**
  The Zod contract (`SmartDiff`/`SmartDiffGroup`/`SmartDiffFile` incl.
  `pseudocode_summary`, `client/src/vendor/shared/contracts/brief.ts:80-113`)
  and i18n keys (`smartDiff.*` in `messages/en/prReview.json`) exist, but
  no server endpoint, no client hook, and no component reads either —
  confirmed via full-repo grep, zero hits outside the contract file. Don't
  assume it's implemented anywhere; building it needs a new LLM-backed
  server endpoint (something has to generate the per-file summary + role
  classification), which is a materially different scope than wiring
  existing `FindingRecord` data through existing components.
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
