# Development Plan: SPEC-03 — PR Brief & Why Timeline

Source spec: [`specs/SPEC-03-pr-brief-and-why-timeline.md`](../../specs/SPEC-03-pr-brief-and-why-timeline.md)
Cross-model review: [`spec-03-pr-brief-and-why-timeline.cross-review.md`](spec-03-pr-brief-and-why-timeline.cross-review.md)
(Cursor / Grok 4.6 High, 2026-08-14 — see [Cross-model review](#cross-model-review)
for what changed as a result.)

## Objective

Ship a server-composed `Brief { what, why, risk_level, risks[], review_focus[] }`
per (PR, `head_sha`) — one structured LLM call, cached, grounded against the PR's
real changed files and hunk ranges, under a hard 8 000-token input budget — plus
a read-only "Why Timeline" over the briefs a PR has accumulated, and a Brief card
whose `review_focus[]` entries deep-link to `path:line` in the Files-changed tab.

## Scope

- **Packages/modules touched:** `server/` (new `modules/brief/`,
  `db/schema/reviews.ts`, `platform/container.ts`, `modules/index.ts`, both
  vendored contract files) · `client/` (new `PrBriefCard` + `BriefTimeline`,
  PR-detail deep-link plumbing, `diff-viewer`, hooks, i18n).
- **Execution mode:** **multi-agent** — the full handoff chain from
  [`agents/README.md`](../../agents/README.md)#handoff-chain
  (`implementer` → `test-writer` → `plan-verifier` → `doc-writer`, each a
  separate invocation), run via the `run-plan` skill. Test authorship and
  documentation are therefore **not** work items here; each work item's
  Definition of done names the behaviour `test-writer` is expected to cover.
- **Explicitly out of scope (feature-specific):** `reviewer-core/**` (untouched —
  this call does not go through `assemblePrompt`, which is *why* AC-37 restates
  untrusted-wrapping locally); `mcp/`, `e2e/`; `PromptParts` / `run-executor` /
  `RunTrace`; the `pr_intent` schema; `IntentService.classify`; `repoIntel.*`
  (called only indirectly, inside `BlastService` — see WI7); `modules/project-context/**`;
  the dead `PrBrief` / `PrHistory` contracts (left in place per D-1/D-2, not
  deleted); backfill of briefs for superseded SHAs (D-6).

## Constraints

**Architectural / repo rules**

- New module goes under `server/src/modules/brief/`, **outside**
  `modules/reviews/`, following routes → service → port ← adapter
  (`modules/blast/` and `modules/onboarding/` are the two precedents). It is
  *not* in `PRE_EXISTING_MODULES` (`server/.dependency-cruiser.cjs:10-11`), so
  all four boundary rules apply to it: `service.ts` may not import
  `src/db/(schema|client)` or `src/adapters/**`; `routes.ts` may not import
  either; `helpers.ts` must stay pure. `pnpm arch:check` is the gate.
  — skill: `onion-architecture`.
- **Verified, so the plan doesn't have to guess** (the spec's Maintainability
  note left this open): dependency-cruiser has **no cross-module rule**, and its
  four rules are direct-dependency rules, not `reachable` rules. So
  `modules/brief/*` importing the pure helpers `specPathsFrom` /
  `isInsideClone` / `renderIntentBlock` / `toIntentDiffSummary` /
  `synthesizeHunkHeaders` / `extractReferences` from
  `modules/reviews/intent-inputs.ts` passes `arch:check`. Reuse them; do not
  copy.
- **`buildLineIndex` genuinely cannot be reused** (spec E-9, now confirmed at two
  levels): `reviewer-core/src/index.ts:28` exports only `groundFindings` /
  `groundingSummary` / `GroundingResult`, and
  `server/src/platform/grounding.ts:6` re-exports exactly those three. Exporting
  it would mean touching `reviewer-core`, which the spec forbids. → mirror the
  rule locally (see WI6).
- **The API assumes a single process.** `reapStaleRuns()` on boot has no
  multi-replica safety (`server/AGENTS.md`), and this plan's double-generation
  guard (WI7) inherits that same assumption rather than working around it.
- Vendored contracts are hand-mirrored, no sync script (root `AGENTS.md`).
  `server/src/vendor/shared/contracts/{brief,review-api}.ts` and their `client/`
  twins are **currently byte-identical** (`git diff --no-index` exits 0 for
  both) — they must still be after this work.
- `src/db/migrations/**` is generated: `pnpm db:generate`, never hand-edited
  (root + `server/AGENTS.md`).
- **Rate limiting is not merely relaxed under test — the plugin is not
  registered at all.** `app.ts:95-97` registers `@fastify/rate-limit` only when
  `config.nodeEnv !== 'test'`, so a per-route `config.rateLimit` is inert in the
  test suite regardless of what an individual test does. See WI8 and the Test
  plan for the consequence for AC-38.
- Client: data only via `src/lib/hooks/*`, never ad-hoc `fetch`; UI only from the
  `@devdigest/ui` barrel; model-authored prose only through
  `src/vendor/ui/primitives/Markdown.tsx` or plain text, never a second
  `react-markdown` instance (`client/AGENTS.md`).

**INSIGHTS.md entries that bind this work**

- `server/INSIGHTS.md` §Recurring Errors (~L520-537) — **`pnpm db:generate`
  writes three artifacts**: the `.sql`, `meta/_journal.json`, and a new
  `meta/NNNN_snapshot.json`. Committing only the `.sql` makes the migration
  silently not exist on a fresh checkout. This exact bug was `plan-verifier`'s
  most severe SPEC-02 finding. `git status --porcelain src/db/migrations/` must
  be checked after generating, and all three staged together.
- `server/INSIGHTS.md` §Recurring Errors (~L506-518) — `pnpm db:generate` prompts
  interactively for column create-vs-rename and cannot be piped; expect a manual
  answer, and accept that it may emit two migration files.
- `server/INSIGHTS.md` (~L348-361) — **cheap models emit stray NUL bytes inside
  otherwise-valid structured output**, and Postgres `text`/`jsonb` reject them.
  `modules/onboarding/repository.drizzle.ts:6-21`'s recursive `scrubJson` (using
  `String.fromCharCode(0)`, never a literal `\0` in source) must be replicated
  for `pr_brief.json`.
- Root `INSIGHTS.md` §Session Notes 2026-08-13 — adding a
  **non-optional-with-`.default()`** field to a Zod contract ripples into every
  hand-built object literal typed against `z.infer`'s *output* type, on both
  sides. Relevant to every new field in WI1.
- Root `INSIGHTS.md` §Tool & Library Notes — `pnpm <script>` can die with
  `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` in this environment; fall back to
  `./node_modules/.bin/<bin>` (extensionless under the Bash tool, `.cmd` under
  PowerShell).
- Root `INSIGHTS.md` §Recurring Errors — `git commit` with no pathspec commits
  the **whole** staged index. AC-43 requires the spec+plan commit to be clean and
  to precede all feature code; use `git commit -- <paths>` and check
  `git diff --cached --stat` first.
- Root `INSIGHTS.md` §Tool & Library Notes — Docker Desktop is not auto-started;
  `*.it.test.ts` self-skip without it. Don't claim integration coverage without
  checking `docker ps`.

## Recommendations

**Calls this plan makes on the spec's four open questions** (the spec left these
to the plan; each is reversible without restructuring the work items):

- **Q-2 — latency / timeout.** Leave `timeoutMs` **unset**, inheriting the LLM
  adapters' `DEFAULT_TIMEOUT = 60_000` (`adapters/llm/openai.ts:15`,
  `anthropic.ts:16`) wrapped in their existing `withRetry`. Rationale: this is
  exactly the call `OnboardingService` made and documented in-line
  (`modules/onboarding/service.ts:191-195`), and two model-spending features
  disagreeing on timeout policy is worse than neither having an SLO. No
  page-load target is set; the GET path is a single indexed row read. Record it
  as a code comment, not a constant, so nobody mistakes it for a tuned value.
- **Q-3 — Overview layout with a 5th/6th panel.** **Do not add panels.**
  `PrBriefCard` *replaces* `PrBriefBanner` in the existing full-width slot above
  `IntentCard | BlastRadiusCard`, and absorbs the `VerdictBanner` render for the
  score gauge (AC-32) so the deterministic score keeps its current home. The Why
  Timeline is **not** a sixth panel — it's a collapsed `<details>` inside
  `PrBriefCard`, the same disclosure pattern `IntentCard` already uses for
  Sources (`IntentCard.tsx:197-208`). Net panel count stays 3. Brief neither
  subsumes nor summarises Intent/Blast — it sits above them as the composed
  judgement, which is what its `what`/`why` prose already is.
- **Q-4 — grounding-drop counts in the UI.** Surface them, but demoted: one line
  inside the card's collapsed **"Inputs"** disclosure (the UX-12 provenance
  toggle) reading e.g. *"2 citations dropped as ungrounded"*, shown only when the
  count is non-zero — plus the structured log line (AC-41). Not on the card's
  primary surface: a reviewer's first read should be `what`/`why`/focus, not
  model-quality telemetry.
- **Q-5 — spec-file sub-cap value.** **`SPEC_INPUT_TOKEN_SUBCAP = 2_500` tokens**
  (31 % of 8 000), across **at most 2** files (`MAX_SPEC_FILES = 2`).
  **The sub-cap is enforced whole-document only — a spec file is admitted intact
  or not at all, never excerpted.** Rationale for the value: the floor (title +
  intent block + blast summary) measures in the low hundreds of tokens, so the
  real competitor for the budget is the changed-file list with hunk headers — and
  that list is what grounding, `review_focus[]` and the whole feature's value
  depend on. Reserving ≥5 500 tokens for it means one linked design doc can never
  starve it (E-12).
  **Revised after cross-model review (point 1):** an earlier draft also imposed a
  6 000-char read-time cap, which sat *below* what 2 500 tokens already admits
  (~10 000 chars by the `chars / 4` heuristic) — so a document that fit the token
  sub-cap was silently truncated before the trim stage ever ran, contradicting
  WI5's own "no item survives partially" rule. The char cap is gone. What remains
  is `MAX_SPEC_FILE_READ_CHARS = 40_000`, a pure **I/O bound** (≈4× the sub-cap's
  char equivalent) so a pathological multi-megabyte `.md` can't be slurped into
  memory before it's measured — it is deliberately far above any value that could
  bind the content decision. Accepted consequence, recorded in Risks: a spec file
  larger than the remaining sub-cap allowance now contributes **nothing** rather
  than its first N characters.

**Approach recommendations beyond the spec**

- **Two read endpoints, not three.** Make `GET /pulls/:id/brief/timeline` return
  each entry's **full** `BriefRecord`, not a summary. AC-15 ("open a specific
  older brief with zero model calls") is then satisfied by the payload already in
  hand (WI12 owns the client behaviour that actually renders it), and — more
  importantly — the NFR's own A01 warning about the timeline being "a new
  enumeration surface" applies to one fewer route. Cap at
  `MAX_TIMELINE_ENTRIES = 50`.
- **Composite primary key `(pr_id, head_sha)`, not a surrogate id + unique
  index.** It serves both access paths from one index (exact lookup, and a
  `pr_id`-prefix scan for the timeline — the NFR's Performance requirement), and
  it gives `onConflictDoUpdate` a natural target so AC-13's "replace, never
  append" is enforced by the database rather than by service logic.
- **Guard E-5 at two layers, and be precise about which guards what.** The
  composite PK makes the **row** idempotent (replace-not-append); it does **not**
  prevent duplicate **spend**. The in-process
  ``inFlight: Map<`${prId}:${headSha}`, Promise>`` (`onboarding/service.ts:93,146-151`
  precedent) is the actual spend guard, and it is **single-process only** — it
  inherits the single-API-process assumption recorded under Constraints. Accepted
  failure mode for this iteration: duplicate spend, one row, last-writer-wins (see
  [Cross-model review](#cross-model-review) point 2).
- **Deep-link is its own work item and touches a shared component.** AC-30 needs a
  URL param pair *and* jump-to-line support added to the plain `DiffViewer`
  (`client/src/components/diff-viewer/DiffViewer/DiffViewer.tsx:17-38`), which
  today takes no jump callback at all (E-22). `FileCard` already supports
  controlled `open`/`onOpenChange` (`FileCard/FileCard.tsx:42,55-56,69-72`), so
  the missing piece is the orchestration in `DiffViewer`, mirroring
  `SmartDiffViewer.tsx:87-100`. This is shared-component work, not PR-page work —
  call it out in review.

## Work items

### WI1 — Contracts: `Brief`, `ReviewFocusItem`, and the API record/response shapes (both vendored copies)

- **Files/modules:** `server/src/vendor/shared/contracts/brief.ts` (append),
  `server/src/vendor/shared/contracts/review-api.ts` (append), then hand-mirror
  **both** into `client/src/vendor/shared/contracts/`.
- **Content:** in `brief.ts` — `ReviewFocusItem { path, line:int, reason }` and
  `Brief { what, why, risk_level: RiskSeverity, risks: Risk[], review_focus: ReviewFocusItem[] }`,
  reusing the existing `Risk` (`brief.ts:92-99`) and `RiskSeverity`
  (`brief.ts:89`) **unchanged** (D-1). In `review-api.ts` — `BriefInputStatus`
  (intent used/missing/stale, blast status, changed-file count,
  `spec_files_used[]` / `spec_files_unresolved[]`, linked-issue state,
  `dropped_inputs[]` — AC-26, UX-12), `BriefUsage` (provider, model,
  `input_tokens`, `tokens_in` / `tokens_out` / `cost_usd` nullable,
  `dropped_risk_refs`, `dropped_focus_items` — AC-10/AC-22), `BriefRecord`,
  `BriefState`, `BriefResponse { state, current_head_sha, record|null, reused, reason|null }`
  (AC-11/AC-17),
  `BriefTimelineEntry { head_sha, generated_at, risk_level, is_current_head, risk_changed, record }`
  (AC-33), `BriefTimelineResponse { entries, brief_count, commit_count }`
  (AC-34/UX-8). Name **nothing** `Why*` (D-3) — `PrHistory` / `PrBrief` stay
  untouched (D-2).
- **`BriefState` is deliberately split into persisted and transient values —
  document this in the schema's own doc comment** (cross-model review point 5):
  `'current' | 'stale' | 'absent' | 'corrupt'` are **read states**, derivable
  from storage and returned by `GET /pulls/:id/brief`;
  `'budget_exceeded' | 'failed'` are **transient generate-only outcomes**,
  returned by `POST …/generate` with `record: null` and never persisted — because
  AC-25 requires zero calls and AC-42 requires that a failed attempt persist
  nothing and leave any prior row intact, so there is by construction no row to
  read them back from. This mirrors `OnboardingTourResponse.status`, which
  likewise carries `llm_failed` as a response state rather than throwing
  (`onboarding/service.ts:202-222`). WI7 produces them; WI11 renders them.
- **Applicable skills:** `zod`, `typescript-expert`.
- **Definition of done:**
  `git diff --no-index server/src/vendor/shared/contracts/brief.ts client/src/vendor/shared/contracts/brief.ts`
  exits 0, same for `review-api.ts`; both packages typecheck; no existing exported
  symbol changed shape; every `BriefState` value has a producer in WI7 and a
  render path in WI11.

### WI2 — Repurpose the `pr_brief` table (schema + generated migration)

- **Files/modules:** `server/src/db/schema/reviews.ts:74-79`,
  `server/src/db/rows.ts` (add `PrBriefRow`), generated
  `server/src/db/migrations/**`.
- **Content:** replace the `prId`-primary-key / single-`json` shape with
  `primaryKey({ columns: [prId, headSha] })` plus `json jsonb notNull`,
  `provider`, `model`, `inputTokens`, `tokensIn`, `tokensOut`, `costUsd`,
  `droppedRiskRefs notNull default 0`, `droppedFocusItems notNull default 0`,
  `droppedInputs jsonb $type<string[]> notNull default '[]'::jsonb`,
  `generatedAt timestamptz notNull defaultNow`. Safe because the table has
  **never been written** (D-4 — grep confirms no reader/writer in `server/src`;
  the only hits are the `db/schema.ts:33,64` re-exports).
- **Applicable skills:** `drizzle-orm-patterns`, `postgresql-table-design`.
- **Definition of done:** `pnpm db:generate` run (answering its interactive
  prompts), `git status --porcelain src/db/migrations/` shows the new `.sql`
  **and** `meta/_journal.json` **and** the new `meta/NNNN_snapshot.json`, all
  three staged; `pnpm db:migrate` applies cleanly against a live Postgres; no
  file under `migrations/` hand-edited.

### WI3 — Module skeleton: constants, both ports, both adapters, DI + registry wiring

- **Files/modules:** new — `server/src/modules/brief/constants.ts`,
  `repository.ts`, `repository.drizzle.ts`, `sources.ts`, `sources.node.ts`.
  Modified — `server/src/platform/container.ts`, `server/src/modules/index.ts`.
- **`constants.ts`** (per `project-context/constants.ts`'s pattern):
  `BRIEF_INPUT_TOKEN_BUDGET = 8_000`, `SPEC_INPUT_TOKEN_SUBCAP = 2_500`,
  `MAX_SPEC_FILES = 2`, `MAX_SPEC_FILE_READ_CHARS = 40_000`,
  `MAX_TIMELINE_ENTRIES = 50`, `MAX_RISKS = 6`, `MAX_FOCUS_ITEMS = 5`,
  `BRIEF_RATE_LIMIT = { max: 10, timeWindow: '1 minute' }`.
  `MAX_SPEC_FILE_READ_CHARS` is an **I/O bound only** — it exists so a
  multi-megabyte `.md` isn't read into memory before it's measured, and is set
  ≈4× above the sub-cap's char equivalent precisely so it can never bind the
  content decision. Admission is decided by `SPEC_INPUT_TOKEN_SUBCAP`, measured
  in tokens, whole-document (see WI5). There is no `MAX_SPEC_FILE_CHARS` — an
  earlier draft's 6 000-char content cap was removed after cross-model review
  (point 1) because it silently truncated documents the token sub-cap would have
  admitted intact.
- **`repository.ts`** — the DB port: interface + plain row types, **no Drizzle
  import** (mirrors `blast/repository.ts` and `onboarding/repository.ts`):
  `getPull`, `getRepo`, `getIntentRecord`, `countCommits`,
  `getBrief(prId, headSha)`, `getLatestBrief(prId)`, `listBriefs(prId, limit)`,
  `upsertBrief`.
- **`sources.ts`** — the non-DB **input** port (`BriefSources`). It is the single
  seam through which `BriefService` obtains everything that isn't a row in this
  module's own tables, which is what keeps `service.ts` free of `node:fs`,
  `src/adapters/**`, and inline construction of other modules' services:
  - `loadDiff(workspaceId, pull, repoRow): Promise<UnifiedDiff>`
  - `readSpecFile(clonePath, ref): Promise<string | null>`
  - `getBlastSummary(workspaceId, prId): Promise<BlastRadiusResponse>` —
    **added after cross-model review (point 8)**; previously `BriefService`
    constructed `new BlastService(...)` inline, which leaked composition out of
    the DI pattern every other collaborator in this module follows. Putting it
    behind the same port keeps the port count at two (the split the review
    confirmed as correct), needs no container change, and makes AC-7 directly
    stubbable — see WI7's Definition of done.
  - `fetchLinkedIssue(repoRow, issueNumber): Promise<string | null>` —
    **added after cross-model review (point 4)**. AC-4 lists the linked issue as
    a required input and AC-24 makes stage 2 of the trim order "the linked issue
    body", but `pr_intent.sources[]` persists only `{ kind: 'linked_issue', ref: '#N' }`,
    never the body — so without this method stage 2 would be a permanent no-op
    and AC-4 would be unmet. Chosen over documenting the input as
    always-unresolved because it adds **no new mechanism**: `getIssue(repo, n)`
    already exists on the `GitHubClient` port (`vendor/shared/adapters.ts:164`)
    and `intent-service.ts:197-209` already calls it via `container.github()`
    with exactly this degrade-on-failure shape. That is the same
    reuse-the-intent-path reasoning D-10 applied to spec files.
- **`sources.node.ts`** — the adapter implementing all four: `loadDiff` delegates
  to `modules/reviews/diff-loader.ts`'s `loadDiff` (constructing
  `new ReviewRepository(container.db)` — legitimate in an infrastructure file);
  `readSpecFile` applies `isInsideClone` (`intent-inputs.ts:138-142`) **on every
  call** and returns `null` on escape or ENOENT (E-14/E-15), reading at most
  `MAX_SPEC_FILE_READ_CHARS`; `getBlastSummary` constructs
  `new BlastService(container.blastRepo, container)` **here**, in infrastructure,
  not in the service; `fetchLinkedIssue` uses `container.github()` and returns
  `null` on any failure (never throws — E-15's degrade-don't-fail rule).
  Precedent for an fs-touching non-`service.ts` module file that already passes
  `arch:check`: `modules/onboarding/facts.ts:11`.
- **`repository.drizzle.ts`** carries the `scrubJson` NUL-stripper. Container
  gains lazy `briefRepo` / `briefSources` getters plus `ContainerOverrides`
  entries; `modules/index.ts` gains one import + one registry entry.
- **Applicable skills:** `onion-architecture`, `drizzle-orm-patterns`,
  `typescript-expert`.
- **Definition of done:** `pnpm arch:check` passes with the new module present;
  `pnpm typecheck` clean; container overrides let a test swap **both** ports, and
  stubbing `BriefSources` alone is sufficient to drive every degraded-input case
  (no diff, no blast, no spec file, no issue) without a real git/fs/GitHub call.

### WI4 — Input assembly + prompt (`prompt.ts`)

- **Files/modules:** `server/src/modules/brief/prompt.ts` (new, pure).
- **Content:** a `BRIEF_INJECTION_GUARD` paragraph equivalent to
  `CLASSIFIER_INJECTION_GUARD` (`intent-service.ts:75-80`) and a system prompt
  asking for `what` / `why` / `risk_level` / `risks` (≤6) / `review_focus` (≤5,
  each `path` + `line` + one-line reason, lines that appear in the given hunk
  headers). `buildBriefSections()` produces the ordered, individually-measurable
  sections: **floor** = PR title, persisted intent block (reuse
  `renderIntentBlock`, `intent-inputs.ts:166-186`), blast summary line (plus its
  `status`/`reason` when degraded — E-4); **trimmable** = spec-file excerpts,
  linked-issue text, per-file hunk headers (`synthesizeHunkHeaders`,
  `intent-inputs.ts:72-83`), changed-file list. **Every** PR/repo-derived block
  wrapped with `wrapUntrusted` (`@devdigest/reviewer-core`), with each spec
  file's own path *inside* its block, never in a trusted heading (AC-37, the
  `intent-service.ts:269-277` pattern). Diff data reaches this file only as
  `IntentDiffSummary` (`intent-inputs.ts:21-37`) — the type has no body field, so
  AC-8 is a signature-level guarantee, not a comment. The linked-issue section is
  present whenever `BriefSources.fetchLinkedIssue` resolved one (WI3) and absent
  otherwise, so AC-24 stage 2 has something real to drop.
- **Applicable skills:** `security`, `typescript-expert`.
- **Definition of done:** pure, unit-testable function; a fixture whose patch text
  contains a unique sentinel produces assembled messages containing zero
  occurrences of it (AC-8); every input block is delimiter-wrapped (AC-37).

### WI5 — Token budget + fixed trim order (`budget.ts`)

- **Files/modules:** `server/src/modules/brief/budget.ts` (new, pure — takes a
  `count: (s: string) => number` so `container.tokenizer` is injected, not
  imported).
- **Content:** measure the fully assembled input (system + user, AC-23) with the
  DI tokenizer (`adapters/tokenizer/index.ts:22-46`) **before** the call.
  **Spec sub-cap first, whole-document only (AC-27):** measure each candidate
  spec document with the same `count`, and admit documents in `sources[]` order
  while the running spec total stays ≤ `SPEC_INPUT_TOKEN_SUBCAP`. A document that
  would push the running total over the sub-cap is **dropped entire** and
  recorded in `dropped_inputs[]` — it is never excerpted, sliced, or
  head-truncated. This is the same "accumulate in priority order, cut at the
  first item that would exceed, never truncate mid-item" rule
  `project-context/service.ts:385-403` already implements, and it is now the
  *only* thing gating spec content (see WI3 on the removal of the char cap).
  Then, while over `BRIEF_INPUT_TOKEN_BUDGET`, apply AC-24's stages **in order**,
  whole items only: (1) drop spec excerpts whole-document from the
  lowest-priority (last-referenced) end; (2) drop the linked-issue block;
  (3) collapse hunk headers to `path (+a/-d)` lines; (4) reduce the changed-file
  list to the largest-by-(additions+deletions) N via a binary search on N (the
  `repo-map` budget-search precedent), always emitting the
  `+N more files not shown` marker. Every stage appends a human string to
  `dropped_inputs[]` (AC-26). If the floor alone exceeds the budget, return
  `{ floorExceeded: true }` — the caller makes **zero** calls (AC-25). Comment
  E-11 honestly: the tokenizer silently degrades to `ceil(chars / 4)` and is
  `cl100k_base` regardless of provider — this is a reproducible budget guard, not
  a provider-exact guarantee.
- **Applicable skills:** `typescript-expert`.
- **Definition of done:** an oversized fixture measures ≤ 8 000 after trimming;
  one assertion per stage proving the order and that no item survives partially;
  a spec document that exceeds the remaining sub-cap allowance is absent
  entirely, not shortened; a floor-only-oversized fixture returns `floorExceeded`
  without producing messages.

### WI6 — Grounding (`grounding.ts`)

- **Files/modules:** `server/src/modules/brief/grounding.ts` (new, pure).
- **Content:** build `Map<path, Set<number>>` from the **full** `UnifiedDiff`
  (E-10 — the model never saw it, grounding may and should use it), mirroring
  `reviewer-core/src/grounding.ts:24-39`'s rule exactly including the
  `newLineNumbers`-empty → `[newStart, newStart + max(newLines, 1))` fallback,
  with a comment citing that file as the source of truth and E-9 as the reason
  it's mirrored rather than imported. Then: drop each `risks[].file_refs` path not
  in the changed-file set, keeping the risk itself even if its refs empty out
  (AC-18, as worded); drop each `review_focus[]` entry whose path is unknown
  **or** whose line is outside that file's hunk lines (AC-19, E-8); never repair,
  only discard (AC-20 — the `groundFindings` / `ConventionsService.groundCandidates`
  (`conventions/service.ts:139-166`) discard contract); cap survivors at
  `MAX_RISKS` / `MAX_FOCUS_ITEMS`; return
  `{ brief, droppedRiskRefs, droppedFocusItems }`. Empty results are valid
  output, never a failure (AC-21).
- **Applicable skills:** `typescript-expert`, `security`.
- **Definition of done:** `src/does-not-exist.ts` in a stub response is absent,
  not rewritten; an out-of-range line and an unknown path each drop, one case per
  test; a `../../etc/passwd`-shaped path drops without any filesystem call
  (AC-39); a fully-ungrounded response still yields a persisted brief with empty
  lists.

### WI7 — `BriefService`

- **Files/modules:** `server/src/modules/brief/service.ts`,
  `server/src/modules/brief/helpers.ts` (both new).
- **Collaborators:** the two WI3 ports **only** — `BriefRepository` and
  `BriefSources`. `service.ts` constructs no other module's service inline and
  imports no adapter (cross-model review point 8): blast arrives via
  `sources.getBlastSummary`, the diff via `sources.loadDiff`, spec files via
  `sources.readSpecFile`, the linked issue via `sources.fetchLinkedIssue`.
- **Content:**
  - `getBrief(workspaceId, prId)` — resolve pull (404 via `NotFoundError` if
    outside workspace), read the row for the **current** `head_sha` →
    `state:'current'`; else newest row → `state:'stale'` naming the commit it
    describes (AC-17); else `absent`. Always `reused: true`, **zero** model calls
    (AC-1/AC-2/AC-12). Re-parse `json` against `Brief` on read; a `safeParse`
    failure yields `state:'corrupt'` with an honest reason instead of a throw
    (AC-40, E-19 — `onboarding/service.ts:293-311`'s exact pattern). This method
    never returns `budget_exceeded` or `failed` — by construction, those attempts
    persisted nothing (WI1).
  - `generate(workspaceId, prId, { headSha, force }, log)` — capture
    `pull.headSha` **once**; refuse with `ConflictError` and zero calls if
    `headSha !== pull.headSha` (AC-16, E-6); if a row exists and `!force`, return
    it with `reused: true`, zero calls (AC-12); dedupe concurrent requests via
    `inFlight` keyed `${prId}:${headSha}` (E-5); read the persisted intent record
    and **never** classify — a missing or SHA-mismatched record degrades and is
    recorded as unresolved (AC-6, E-3, which also empties the spec input per
    D-10); read blast through `sources.getBlastSummary` — no model call, degraded
    status carried into the prompt (AC-7, E-4); resolve spec paths with
    `specPathsFrom(record)` (`intent-inputs.ts:194-198`) and re-read each fresh
    through `sources.readSpecFile` (AC-5, E-14/E-15); resolve the linked issue by
    running `extractReferences` (`intent-inputs.ts:106-128`) over the PR body and
    passing the first issue number to `sources.fetchLinkedIssue`, recording it as
    unresolved when that returns `null` (AC-4); build → budget → **one**
    `llm.completeStructured` against a module-local response schema (the
    `IntentClassifierOutput` / `OnboardingLlmResponse` pattern), model from
    `resolveFeatureModel(container, workspaceId, 'risk_brief')`
    (`feature-models.ts:51-55`, AC-9); ground; persist via upsert (AC-13); return
    `{ state: 'current', record, reused: false }`.
    **Transient outcome states (WI1):** when `budget.floorExceeded`, return
    `{ state: 'budget_exceeded', record: null }` having made zero calls and
    written nothing (AC-25); when the provider throws or the response still fails
    schema validation after the adapter's own retries, return
    `{ state: 'failed', record: null }` — persisting **nothing**, leaving any
    prior row for that SHA untouched, with no automatic retry (AC-42), via one
    `catch`, `onboarding/service.ts:202-222`'s shape. Neither is an HTTP error:
    both are modeled response states, consistent with
    `OnboardingTourResponse.status`.
    Outcome log carries prId, headSha, `inputTokens`, dropped-input and
    dropped-citation counts, provider/model, tokens, cost — and **never** diff
    bodies, spec contents, assembled input, or the raw response (AC-41).
  - **Concurrency, stated precisely** (cross-model review point 2 — recorded here
    and not only in the appendix, because this is where it will be implemented):
    the composite primary key from WI2 makes the **row** idempotent, i.e. a second
    write for the same `(pr_id, head_sha)` replaces rather than appends (AC-13).
    It does **not** prevent duplicate **spend** — two simultaneous generations
    both pay for their model call and the later one simply overwrites. The
    `inFlight` map is the actual spend guard, and it is **in-process only**,
    inheriting the single-API-process assumption recorded under Constraints. This
    failure mode (duplicate spend, one row, last-writer-wins) was reviewed and
    accepted for this iteration; do not add an advisory lock without a decision
    to revisit it.
  - `getTimeline(workspaceId, prId)` — all rows for the PR, newest-first, capped,
    plus `commit_count` from `pr_commits`; **zero** model calls (AC-14/AC-15).
  - `helpers.ts` (pure): `deriveBriefState`, `markRiskChanges` (AC-33 — compare
    each entry to the next-older), `mapRowToRecord`, `buildInputStatus`.
- **Applicable skills:** `onion-architecture`, `security`, `typescript-expert`,
  `zod`.
- **Definition of done:** `arch:check` clean; `service.ts` imports no adapter and
  constructs no other module's service; a `MockLLMProvider`
  (`adapters/mocks.ts:59,90`) records exactly one `completeStructured` and zero
  `complete` per generation, and zero of either on every read/timeline path.
  **AC-7 is verified by stubbing/spying `BriefSources.getBlastSummary` and
  asserting the brief path calls it exactly once — *not* by asserting zero
  `repoIntel` calls** (cross-model review point 3): `BlastService.getBlastRadius`
  calls `repoIntel.getBlastRadius` and `repoIntel.getIndexState` internally
  (`blast/service.ts:41-51`), so "no `repoIntel` call" is false at the facade
  layer even though the brief path is compliant with D-5. What AC-7 actually
  requires — that Brief consumes blast's composed output rather than recomputing
  it — is exactly what the port stub proves.

### WI8 — Routes

- **Files/modules:** `server/src/modules/brief/routes.ts` (new).
- **Content:** `GET /pulls/:id/brief`, `POST /pulls/:id/brief/generate`
  (`config: { rateLimit: { max: 10, timeWindow: '1 minute' } }` — same as
  `reviews/routes.ts:43,65`, AC-38), `GET /pulls/:id/brief/timeline`. Every
  handler calls `getContext(app.container, req)` **before** any work and 404s for
  a PR outside the workspace (AC-36, the `blast/routes.ts:22-23` barrier) —
  including the list route, per the NFR's A01 IDOR note. `params: IdParams`
  (`_shared/schemas.ts:11`) plus a zod body schema for generate
  (`{ head_sha: string, force?: boolean }`); no hand-rolled
  `Schema.parse(req.body)` in a handler (`server/AGENTS.md`).
- **Applicable skills:** `fastify-best-practices`, `zod`, `security`,
  `onion-architecture`.
- **Definition of done:** `arch:check` clean; routes appear in
  `routes-smoke.test.ts`'s surface; a PR of workspace A addressed from workspace
  B 404s on all three.
  **AC-38 requires a harness change, not just a test** (cross-model review point
  7): `@fastify/rate-limit` is registered only when `config.nodeEnv !== 'test'`
  (`app.ts:95-97`), so the per-route `config.rateLimit` written in this work item
  is **inert under the test suite** and no amount of per-test setup changes that.
  The mechanism that exists today is `BuildAppOptions.config`
  (`app.ts:28-32,41-42`): a test can call
  `buildApp({ config: { ...loadConfig(), nodeEnv: 'production' }, … })` to get the
  plugin registered — `nodeEnv` branches in only two places in `app.ts` (line 56,
  a development-only branch, and line 95), so `'production'` is a safe value for
  this purpose. **No existing test in `server/test/` does this** (verified by
  grep — every `rateLimit` hit is an `astgrep`/`adapters` fixture, not a harness).
  So the DoD is: either AC-38 is covered by a test that stands up the app this
  way, or it is reported as an explicitly uncovered AC with this paragraph as the
  reason. It must not be reported as covered because the route carries the config
  object.

### WI9 — Client data layer

- **Files/modules:** `client/src/lib/hooks/brief.ts` (new),
  `client/src/lib/hooks/index.ts`, `client/src/lib/types.ts`.
- **Content:** `usePrBrief(prId)`, `usePrBriefTimeline(prId, { enabled })` (lazy —
  only fetch when the timeline disclosure opens), `useGeneratePrBrief(prId)`.
  Structural copy of `hooks/onboarding.ts`. Query keys: `["pr-brief", prId]` and
  `["pr-brief-timeline", prId]`.
  **`useGeneratePrBrief`'s `onSuccess` must touch both caches** (cross-model
  review point 6): `qc.setQueryData(["pr-brief", prId], data)` **and**
  `qc.invalidateQueries({ queryKey: ["pr-brief-timeline", prId] })` — otherwise a
  just-generated `head_sha` does not appear in the Why Timeline until a remount,
  which is precisely the interaction the feature is built around (generate → see
  it enter the timeline). Skip the timeline invalidation when the response state
  is `budget_exceeded` or `failed`, since nothing was persisted.
  Re-export the new contract types from `lib/types.ts`.
- **Applicable skills:** `react-best-practices`, `next-best-practices`.
- **Definition of done:** `pnpm typecheck` clean; no component calls `fetch`
  directly; a successful generation invalidates the timeline query, and a
  `failed`/`budget_exceeded` response does not.

### WI10 — i18n

- **Files/modules:** `client/messages/en/brief.json`.
- **Content:** add `card.*`, `focus.*`, `timeline.*`, `generate.*`, `inputs.*`
  subtrees, including copy for the `budget_exceeded` and `failed` generate
  outcomes (WI11). Do **not** touch or reuse `brief.why.*` (git-why's, D-3/AC-35)
  and do not redefine `title`, `unavailable`, `unavailableHint`, `block.*`,
  `noRisks`, `noHistory`, `overlap`, `viewBlast`. `unavailable` /
  `unavailableHint` stay in use for the *no-review* case inside the new card, so
  UX-1's two absences read differently: "no brief yet" (offers Generate) vs "no
  review yet" (no score gauge). The user-facing timeline label stays **"Why
  Timeline"** (D-3/UX-10) under the `timeline.*` key.
- **Applicable skills:** none.
- **Definition of done:** a test asserts no key collision with the pre-existing
  set; JSON parses; every new key is referenced by a component.

### WI11 — `PrBriefCard` (replaces `PrBriefBanner`)

- **Files/modules:** new —
  `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/_components/PrBriefCard/{PrBriefCard.tsx,helpers.ts,styles.ts,index.ts}`;
  delete `.../OverviewTab/_components/PrBriefBanner/**` (incl. its test).
- **Content:** risk-level badge, `what` / `why` prose, the describing commit
  always labelled (AC-28/UX-3), stale banner naming the newest brief's commit
  (AC-17), an ordered activatable `review_focus[]` list rendering
  `path:line — reason` (AC-29), a `risks[]` block, Generate/Regenerate saying it
  spends one call on `provider/model` (UX-7) with the last generation's
  `cost_usd` handled as nullable (E-20), and a collapsed **Inputs** disclosure
  carrying `BriefInputStatus` + the Q-4 drop counts (UX-11/UX-12). The **score
  gauge keeps its existing deterministic source**: reuse `usePrReviews` exactly as
  `PrBriefBanner.tsx:26-47` does and render `VerdictBanner` only when a completed
  review exists, omitted otherwise (AC-32, D-9, E-21) — the model's `risk_level`
  must be visually distinct from it (UX-2). Empty state offers Generate and issues
  **no** request on mount (AC-2 — `IntentCard.tsx:70-92`'s empty→derive shape).
  Model-authored prose goes through the centralized `Markdown` primitive or
  renders as plain text; never `dangerouslySetInnerHTML`.
- **Every `BriefState` gets a render path** (cross-model review point 5) — the
  four observable states the NFR's Observability section claims must actually be
  distinguishable on screen: `absent` (offer Generate), `stale` (banner naming the
  described commit + Regenerate), `corrupt` (honest "couldn't read the stored
  brief, regenerate to fix" — E-19), plus the two transient generate outcomes:
  `budget_exceeded` (explain that the inputs alone exceeded the budget and that
  **no call was made / nothing was charged** — AC-25) and `failed` (explain the
  attempt failed, that any previous brief is unchanged, and offer a retry the
  user initiates — AC-42, never an automatic one). Both transient states render
  in place over the existing card content rather than replacing a good brief with
  an error.
- **Applicable skills:** `react-best-practices`, `react-project-structure`,
  `next-best-practices`, `security`.
- **Definition of done:** `pnpm typecheck` and `pnpm test` clean (incl.
  `src/test/smoke.test.tsx`); no request fires on render of the empty state; each
  of the six `BriefState` values renders a distinguishable state, and
  `budget_exceeded` explicitly states that nothing was spent.

### WI12 — `BriefTimeline` panel

- **Files/modules:** new —
  `.../OverviewTab/_components/PrBriefCard/_components/BriefTimeline/{BriefTimeline.tsx,styles.ts,index.ts}`.
- **Content:** one entry per persisted brief, newest first, each showing
  `head_sha`, generation time and `risk_level`; entries whose `risk_level` differs
  from the one before are visually marked (AC-33/UX-9). A disclosure line states
  the gap honestly using `brief_count` / `commit_count` — e.g. *"3 briefs
  generated across 12 commits"* — and never implies full coverage
  (AC-34/UX-8/E-1). Rendered inside `PrBriefCard`'s collapsed `<details>` per the
  Q-3 call; opening it is what enables `usePrBriefTimeline`.
- **Entries are activatable, and activating one renders that historical brief**
  (cross-model review point 9 — AC-15 needs a client behaviour, not just a server
  payload that happens to contain the record): clicking an entry swaps
  `PrBriefCard`'s displayed content to that entry's `BriefRecord`, which is
  **already fully present in the timeline payload** (the "two endpoints, not
  three" decision above), so this costs **zero** additional requests and zero
  model calls. While a historical brief is displayed the card must (a) label
  which commit it describes and that it is *not* the current head, and (b) offer
  an unambiguous way back to the current-head view. `review_focus[]` entries on a
  historical brief remain subject to WI14's AC-31 check — a focus entry whose file
  is absent from the currently loaded diff degrades and does not navigate.
- **Applicable skills:** `react-best-practices`, `react-project-structure`.
- **Definition of done:** three briefs of differing risk levels render with
  exactly the expected change markers; the disclosure string is present;
  activating an older entry renders that entry's `what` / `why` / `review_focus`
  with a not-current-head label and a working return path, and issues no new
  request.

### WI13 — Cross-tab `path:line` deep-link (the AC-30 / E-22 item)

- **Files/modules:** `client/src/app/repos/[repoId]/pulls/[number]/page.tsx`;
  `.../_components/DiffTab/DiffTab.tsx`;
  `.../_components/SmartDiffViewer/SmartDiffViewer.tsx`;
  `client/src/components/diff-viewer/DiffViewer/DiffViewer.tsx`;
  `client/src/lib/types.ts` (a `FocusDiffLineOptions` type beside
  `FocusFindingsOptions`).
- **Content:** add `file` and `line` URL params alongside the existing
  `tab` / `trace` / `run` / `severity` / `finding` set (`page.tsx:72-97`) and a
  `focusDiffLine({ path, line })` helper built on the existing `setParams`, so the
  link is shareable and survives reload (UX-6). `DiffTab` accepts `diffFocus` and
  threads it to whichever viewer is active. `SmartDiffViewer` accepts external
  focus and reuses its existing `onJumpToLine` (`SmartDiffViewer.tsx:91-100`).
  `DiffViewer` gains the same capability from scratch: expand-then-
  `requestAnimationFrame`×2-then-`scrollIntoView` against
  `[data-diff-line="${path}:${line}"]` (`CodeLine.tsx:83`), so the link behaves
  identically in both order modes (E-22). Both viewers no-op safely when the path
  isn't in `files`.
  **Implement `DiffViewer`'s open control as an optional focus overlay, not by
  lifting every file card into controlled state** (cross-model review point 5's
  one underspecified note): only the focused file is forced open via `FileCard`'s
  existing controlled `open` / `onOpenChange` props
  (`FileCard.tsx:42,55-56,69-72`); every other file keeps its current
  uncontrolled `AUTO_EXPAND_MAX_LINES` default (`diff-viewer/constants.ts:4`,
  applied at `FileCard.tsx:67`). Regressing that default for unfocused files
  would change diff browsing for every existing user of this shared component.
- **Applicable skills:** `react-best-practices`, `react-project-structure`,
  `next-best-practices`.
- **Definition of done:** activating a focus entry lands on the right line in
  **smart** order and in **original** order; the params survive a remount; nothing
  scrolls when the path is absent; **unfocused files in `DiffViewer` retain
  `AUTO_EXPAND_MAX_LINES` auto-expand behaviour unchanged**.

### WI14 — Wire it into Overview + the AC-31 stale-file degrade

- **Files/modules:** `.../OverviewTab/OverviewTab.tsx`,
  `client/src/app/repos/[repoId]/pulls/[number]/page.tsx`.
- **Content:** swap `PrBriefBanner` → `PrBriefCard` in the existing full-width
  slot (`OverviewTab.tsx:33-47`), keeping `IntentCard | BlastRadiusCard`
  unchanged (Q-3 call). Thread `onFocusDiffLine` down from `page.tsx`, plus
  `changedFilePaths={pr.files.map(f => f.path)}` so `PrBriefCard` can check
  membership **before** navigating: a focus entry whose file isn't in the loaded
  data (because the PR advanced past the brief's `head_sha`, or because the user
  is viewing a historical brief from WI12) renders an explanatory disabled state
  and navigates nowhere (AC-31).
- **Applicable skills:** `react-best-practices`, `react-project-structure`.
- **Definition of done:** Overview renders 3 panels; a stale brief's dangling
  focus entry is non-navigating and explains itself.

## Test plan

Commands are taken verbatim from each package's `AGENTS.md` — none invented. If
`pnpm <script>` aborts with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`, fall
back to the package-local binary per root `INSIGHTS.md`.

```
# server (cd server)
pnpm typecheck
pnpm arch:check
pnpm exec vitest run --exclude '**/*.it.test.ts'     # unit
pnpm exec vitest run .it.test                        # integration — needs Docker
                                                     # (check `docker ps` first;
                                                     #  these self-skip without it)

# db (cd server) — after WI2 only
pnpm db:generate     # interactive; then verify `git status --porcelain src/db/migrations/`
                     # lists the .sql + meta/_journal.json + meta/NNNN_snapshot.json
pnpm db:migrate

# client (cd client)
pnpm typecheck
pnpm test
```

Server tests live flat in `server/test/*.test.ts` (unit) and
`server/test/*.it.test.ts` (integration); client tests are colocated
`*.test.tsx` beside each component.

**AC-38 (rate limiting) needs a harness change, not just a test.** Sharpened
after cross-model review (point 7) — the plan previously under-stated this. The
rate-limit plugin is registered only when `config.nodeEnv !== 'test'`
(`app.ts:95-97`), so under the test suite the per-route `config.rateLimit` from
WI8 is inert and "enable it inside the test" is not a thing that can be done at
the route level. The mechanism that *does* exist is `BuildAppOptions.config`
(`app.ts:28-32,41-42`): stand the app up for that one test with
`buildApp({ config: { ...loadConfig(), nodeEnv: 'production' }, … })`, which
registers the plugin; `nodeEnv` is read in only two places in `app.ts` (line 56,
a development-only branch, and line 95), so `'production'` has no other effect
here. **No existing test in `server/test/` does this** — verified by grep, every
`rateLimit` hit is an `astgrep`/`adapters` fixture. `test-writer` should either
build that harness for the AC-38 case or report AC-38 as genuinely uncovered with
this paragraph as the reason; it must not be reported as covered on the strength
of the route config alone.

## Risks / Open questions

- **A spec file larger than the remaining sub-cap allowance now contributes
  nothing**, where an earlier draft would have contributed its first 6 000
  characters. This is the deliberate consequence of removing the read-time
  content cap (cross-model review point 1) so that "no item survives partially"
  holds uniformly. Net effect: for PRs linking a large design doc, the docs input
  may be empty more often than the spec's D-10 narrative implies. UX-12's "say
  which inputs the brief actually had" is what keeps this honest rather than
  invisible. If the coordinator prefers excerpting to dropping, that is a
  one-constant change in WI3 + a rule change in WI5 — but it reintroduces the
  contradiction the review flagged, so it should be a recorded decision, not a
  drift.
- **AC-38 cannot be satisfied without touching the test harness.** See the Test
  plan note above. This is now a required, scoped piece of work for
  `test-writer`, not an optional gap — but it is also the one AC whose coverage
  depends on infrastructure this plan does not otherwise change.
- **`pnpm db:generate` is interactive and may emit two migration files** for a
  primary-key change (drop PK + add composite PK). That's acceptable per
  `server/INSIGHTS.md`; do not fight the prompt to force one file. If the answer
  to "created or renamed" is ambiguous, stop and ask rather than guessing — a
  wrong answer here silently drops the column on a fresh checkout.
- **E-2 (unsynced `pr_files`) makes generation cost a call for a brief that can
  cite nothing.** The spec describes the state but sets no rule. This plan does
  **not** add a pre-flight refusal for it — that would be inventing an AC.
  Flagging it: if the coordinator wants a "sync the PR first" guard, it's a
  one-line service check, but it needs to be an explicit decision, not an
  implementer's judgement call.
- **The Why Timeline's accumulation trigger is weak** (cross-model review point
  3). With no auto-generation (D-8) and no backfill (D-6), a typical PR yields a
  one-row timeline; the only thing that grows it is a user noticing the stale
  banner and choosing to spend a call. The reviewer classified this as a
  coordinator call — ship WI12 this round, or hold it for a stronger trigger —
  not a plan defect. No plan change was made.
- **The four Q-answers above are plan-level calls, not spec decisions.** Q-3 in
  particular is a layout/product call the spec deliberately declined; if the
  coordinator disagrees, only WI11/WI12/WI14 change, and the server half is
  unaffected.
- **`brief.unavailable` / `unavailableHint` semantics shift.** They currently mean
  *no review has run*; this plan keeps them meaning exactly that inside the new
  card. If a reviewer of the diff reads them as "no brief", the copy needs a
  rename — which would be a *new* key, never a redefinition (AC-35).
- **`INSIGHTS.md` corrections the planner can't make itself** (planner write scope
  is `docs/plans/` only): (a) the spec's Maintainability paragraph leaves open
  "whether that import is acceptable to the dependency-cruiser boundary check" —
  it is, verified against `server/.dependency-cruiser.cjs`, which has no
  cross-module rule and no `reachable` rules; (b) the rate-limit-plugin-not-
  registered-under-test fact (`app.ts:95-97`) is sharper than
  `server/AGENTS.md`'s "rate limiting is fully disabled" line and cost this plan
  a revision to get right. Both are worth recording in `server/INSIGHTS.md` at
  session end.
- **No live end-to-end verification is assumed.** Docker is not auto-started here,
  and `risk_brief` defaults to a premium model (`gpt-4.1`, `platform.ts:59-64`) —
  plus this environment has previously had exhausted OpenAI/Anthropic credit
  (root `INSIGHTS.md`, 2026-08-02). A real generation against a real provider is
  not part of any work item's Definition of done.

## Explicitly out of scope

Architecture review, spec-compliance verification, and documentation are owned by
downstream agents — see [`agents/README.md`](../../agents/README.md)#handoff-chain.
Feature-specific exclusions are listed under **Scope** above.

---

## For the human coordinator — what an independent plan reviewer should scrutinise

*(Required by SPEC-03 AC-44. The cross-model review happens **outside** this
pipeline and is not orchestrated by the spec or this plan. Review the **plan**,
not the code — at the time this section was written, no SPEC-03 feature code
existed. These five points were the brief handed to the reviewer; their verdicts
are recorded in [Cross-model review](#cross-model-review) below and in the linked
note.)*

1. **Is the `(pr_id, head_sha)` cache key race-safe under concurrent
   generation?** The plan stacks an in-process `inFlight` map (WI7) on a
   composite-PK upsert (WI2). Neither is a lock. Two API processes, or one
   process where the map key is computed from a `headSha` read *before* another
   request's read, still both pay for a call — the second's row simply overwrites
   the first's. Is "duplicate spend, single row, last-writer-wins" the right
   failure mode, or does E-5 demand a real advisory lock, or an
   `INSERT … ON CONFLICT DO NOTHING`-then-poll? Note `server/AGENTS.md` already
   documents a single-API-process assumption (`reapStaleRuns()`).
2. **Is AC-24's trim order the right priority ordering — and does the plan's
   sub-cap distort it?** The plan drops spec excerpts *first* (before the linked
   issue, before hunk headers) while simultaneously arguing under Q-5 that spec
   text is the input most likely to starve the file list. Those two positions are
   consistent only if spec text is genuinely the least valuable input. A PR that
   links its design doc is exactly the case D-10 says produces a better brief —
   and this order sacrifices that input first. Also check whether the sub-cap and
   any read-time cap are mutually consistent.
3. **Does AC-16's "current SHA only" leave the timeline usefully complete?** With
   no auto-generation (D-8) and no backfill (D-6), a typical PR yields one brief,
   and the "Why Timeline" is a one-row list. The plan surfaces `brief_count` /
   `commit_count` to be honest about that (WI12), but honesty about emptiness
   isn't the same as usefulness.
4. **Is the two-port split (`repository` + `sources`) proportionate, or
   ceremony?** WI3 introduces a second port so `service.ts` avoids `node:fs` and
   so security tests can assert a non-read. *(Note: an earlier revision of this
   item compared against `OnboardingService`'s inline `new RepoRepository(container.db)`.
   The reviewer correctly identified that as the wrong precedent — that is a DB
   reach, not a filesystem reach; the real analog is `onboarding/facts.ts:11`,
   which imports `node:fs/promises` directly from a non-`service.ts` module file
   and passes `arch:check`.)*
5. **WI13 modifies a shared component
   (`client/src/components/diff-viewer/DiffViewer`) used outside this feature.**
   Is the blast radius of adding open-state control to `DiffViewer` understood,
   and could AC-30 be met without touching it?

## Cross-model review

**Reviewer:** Cursor / Grok 4.6 High — a different model family from the
Claude-based `implementation-planner` that authored this plan.
**Date:** 2026-08-14.
**Note:** [`spec-03-pr-brief-and-why-timeline.cross-review.md`](spec-03-pr-brief-and-why-timeline.cross-review.md)
(full verdicts and reasoning; this section records only what changed here).

Verdicts on the five seeded scrutiny points: #1 concurrent generation — plausible
concern, **accepted as-is**; #2 trim order — **confirmed issue** (narrow); #3
timeline completeness — plausible concern, coordinator call, no plan change; #4
two-port split — **no issue**; #5 shared `DiffViewer` — **no issue**, one
underspecified point. Six further problems were found outside the seeded list.

What changed in this plan as a result:

1. **Char/token cap contradiction removed** (review point 2, the one confirmed
   defect). `MAX_SPEC_FILE_CHARS = 6_000` sat below what
   `SPEC_INPUT_TOKEN_SUBCAP = 2_500` already admits, silently truncating
   documents the sub-cap would have taken intact. The content cap is deleted;
   `MAX_SPEC_FILE_READ_CHARS = 40_000` remains as a pure I/O bound. — WI3, WI5,
   Q-5 rationale, Risks.
2. **Concurrency guard restated at the work item.** The composite PK makes the
   *row* idempotent, not the *spend*; `inFlight` is the spend guard and is
   single-process only. — WI7 (new sub-bullet), Recommendations, Constraints.
3. **AC-7's verify clause corrected.** `BlastService.getBlastRadius` calls
   `repoIntel` internally, so "assert zero `repoIntel` calls" is false at the
   facade layer; `test-writer` is now told to stub/spy the blast port instead. —
   WI7 Definition of done.
4. **Linked-issue body given an owner.** `BriefSources.fetchLinkedIssue` added,
   reusing the `GitHubClient.getIssue` port the intent classifier already uses,
   so AC-4 is met and AC-24 stage 2 is no longer a permanent no-op. — WI3, WI4,
   WI7.
5. **`failed` / `budget_exceeded` wired end to end.** Documented in the contract
   as transient generate-only states (consistent with
   `OnboardingTourResponse.status` rather than throwing), produced by WI7, and
   given explicit render paths in WI11. — WI1, WI7, WI10, WI11.
6. **Timeline cache invalidation added** to `useGeneratePrBrief`'s success
   handler, so a just-generated SHA appears in the timeline without a remount. —
   WI9.
7. **AC-38 sharpened from a hedge to a scoped requirement.** The rate-limit
   plugin is not registered at all under `NODE_ENV=test`, so per-route config is
   inert; the harness must stand the app up via `BuildAppOptions.config`, and no
   existing test does. — Constraints, WI8 Definition of done, Test plan, Risks.
8. **Composition leak fixed.** `new BlastService(...)` moved out of
   `BriefService` and behind `BriefSources.getBlastSummary`, keeping the port
   count at two and requiring no container change. — WI3, WI7.
9. **AC-15's client behaviour specified.** Activating a timeline entry now
   renders that historical brief from the payload already in hand, with a
   not-current-head label and a return path. — WI12.

Plus review point 5's one underspecified note folded in: `DiffViewer`'s focus is
an optional overlay on the focused file only, preserving `AUTO_EXPAND_MAX_LINES`
for every other file. — WI13.

Deliberately **not** changed, because the review confirmed them as non-issues:
the WI3 two-port split, and WI13's decision to touch the shared `DiffViewer`.

**SPEC-03 AC-44 is satisfied**: the Development Plan carries a clearly-marked
section naming what an independent reviewer should scrutinise, that review has
been performed by a different model family, its note is committed alongside this
plan, and every confirmed finding is either fixed above or recorded as an
explicit, justified non-change.
