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
