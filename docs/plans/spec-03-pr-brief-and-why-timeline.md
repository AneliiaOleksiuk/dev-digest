# Development Plan: SPEC-03 — PR Brief & Why Timeline

Source spec: [`specs/SPEC-03-pr-brief-and-why-timeline.md`](../../specs/SPEC-03-pr-brief-and-why-timeline.md)

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
  `RunTrace`; the `pr_intent` schema; `IntentService.classify`; `repoIntel.*`;
  `modules/project-context/**`; the dead `PrBrief` / `PrHistory` contracts (left
  in place per D-1/D-2, not deleted); backfill of briefs for superseded SHAs
  (D-6).

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
  `synthesizeHunkHeaders` from `modules/reviews/intent-inputs.ts` passes
  `arch:check`. Reuse them; do not copy.
- **`buildLineIndex` genuinely cannot be reused** (spec E-9, now confirmed at two
  levels): `reviewer-core/src/index.ts:28` exports only `groundFindings` /
  `groundingSummary` / `GroundingResult`, and
  `server/src/platform/grounding.ts:6` re-exports exactly those three. Exporting
  it would mean touching `reviewer-core`, which the spec forbids. → mirror the
  rule locally (see WI6).
- Vendored contracts are hand-mirrored, no sync script (root `AGENTS.md`).
  `server/src/vendor/shared/contracts/{brief,review-api}.ts` and their `client/`
  twins are **currently byte-identical** (`git diff --no-index` exits 0 for
  both) — they must still be after this work.
- `src/db/migrations/**` is generated: `pnpm db:generate`, never hand-edited
  (root + `server/AGENTS.md`).
- Rate limiting is fully disabled under `NODE_ENV=test` (`server/AGENTS.md`) — so
  it can neither be relied on as the E-5 concurrency guard, nor tested without
  explicit enablement (AC-38).
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
  (31 % of 8 000), across **at most 2** files (`MAX_SPEC_FILES = 2`), each
  pre-capped at **6 000 chars** at read time (`MAX_SPEC_FILE_CHARS = 6_000`,
  ≈1 500 tokens by the `chars/4` heuristic) with an explicit truncation marker
  inside its untrusted block. Rationale: the floor (title + intent block + blast
  summary) measures in the low hundreds of tokens, so the real competitor for the
  budget is the changed-file list with hunk headers — and that list is what
  grounding, `review_focus[]` and the whole feature's value depend on. Reserving
  ≥5 500 tokens for it means one linked design doc can never starve it (E-12).
  6 000 chars is roughly a spec's Goals + Acceptance-criteria head section, which
  is the part that actually informs a brief. The spec's own vocabulary sanctions
  this: AC-24 stage 1 calls these "spec/plan file **excerpts**" — read-time
  excerpting is ingest, not the mid-content truncation AC-24 forbids during
  overflow trim. Note this in the code comment so a reviewer doesn't read it as
  an AC-24 violation.

**Approach recommendations beyond the spec**

- **Two read endpoints, not three.** Make `GET /pulls/:id/brief/timeline` return
  each entry's **full** `BriefRecord`, not a summary. AC-15 ("open a specific
  older brief with zero model calls") is then satisfied by the payload already in
  hand, and — more importantly — the NFR's own A01 warning about the timeline
  being "a new enumeration surface" applies to one fewer route. Cap at
  `MAX_TIMELINE_ENTRIES = 50`.
- **Composite primary key `(pr_id, head_sha)`, not a surrogate id + unique
  index.** It serves both access paths from one index (exact lookup, and a
  `pr_id`-prefix scan for the timeline — the NFR's Performance requirement), and
  it gives `onConflictDoUpdate` a natural target so AC-13's "replace, never
  append" is enforced by the database rather than by service logic. It also makes
  the E-5 double-generation race *idempotent at the storage layer* even if the
  in-process guard is bypassed.
- **Guard E-5 at two layers, and say so.** In-process
  ``inFlight: Map<`${prId}:${headSha}`, Promise>`` (`onboarding/service.ts:93,146-151`
  precedent) plus the composite PK above. Neither alone is sufficient: the map has
  no multi-replica safety (`server/AGENTS.md` already records the single-process
  assumption), and the PK stops duplicate *rows* but not duplicate *spend*. This
  is the first item handed to the independent plan reviewer (see final section).
- **Deep-link is its own work item and touches a shared component.** AC-30 needs a
  URL param pair *and* controlled-open + jump support added to the plain
  `DiffViewer` (`client/src/components/diff-viewer/DiffViewer/DiffViewer.tsx:17-38`),
  which today takes no jump callback at all (E-22). `FileCard` already supports
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
  `BriefState = 'current'|'stale'|'absent'|'budget_exceeded'|'failed'|'corrupt'`,
  `BriefResponse { state, current_head_sha, record|null, reused, reason|null }`
  (AC-11/AC-17),
  `BriefTimelineEntry { head_sha, generated_at, risk_level, is_current_head, risk_changed, record }`
  (AC-33), `BriefTimelineResponse { entries, brief_count, commit_count }`
  (AC-34/UX-8). Name **nothing** `Why*` (D-3) — `PrHistory` / `PrBrief` stay
  untouched (D-2).
- **Applicable skills:** `zod`, `typescript-expert`.
- **Definition of done:**
  `git diff --no-index server/src/vendor/shared/contracts/brief.ts client/src/vendor/shared/contracts/brief.ts`
  exits 0, same for `review-api.ts`; both packages typecheck; no existing exported
  symbol changed shape.

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
- **Content:** `constants.ts` (per `project-context/constants.ts`'s pattern)
  holds `BRIEF_INPUT_TOKEN_BUDGET = 8_000`, `SPEC_INPUT_TOKEN_SUBCAP = 2_500`,
  `MAX_SPEC_FILES = 2`, `MAX_SPEC_FILE_CHARS = 6_000`,
  `MAX_TIMELINE_ENTRIES = 50`, `MAX_RISKS = 6`, `MAX_FOCUS_ITEMS = 5`,
  `BRIEF_RATE_LIMIT = { max: 10, timeWindow: '1 minute' }`.
  `repository.ts` is the DB port — interface + plain row types, **no Drizzle
  import** (mirrors `blast/repository.ts` and `onboarding/repository.ts`):
  `getPull`, `getRepo`, `getIntentRecord`, `countCommits`,
  `getBrief(prId, headSha)`, `getLatestBrief(prId)`, `listBriefs(prId, limit)`,
  `upsertBrief`.
  `sources.ts` is the second port (`BriefSources`) with
  `loadDiff(workspaceId, pull, repoRow): Promise<UnifiedDiff>` and
  `readSpecFile(clonePath, ref): Promise<string|null>` — this exists so
  `service.ts` never imports `node:fs` or `src/adapters/**`, and so the AC-5
  traversal test can assert *no read occurred* against a stub.
  `sources.node.ts` implements it: `loadDiff` delegates to
  `modules/reviews/diff-loader.ts`'s `loadDiff` (constructing
  `new ReviewRepository(container.db)` — infrastructure file, allowed);
  `readSpecFile` applies `isInsideClone` (`intent-inputs.ts:138-142`) **on every
  call** and returns `null` on escape or ENOENT (E-14/E-15).
  `repository.drizzle.ts` carries the `scrubJson` NUL-stripper. Container gains
  lazy `briefRepo` / `briefSources` getters plus `ContainerOverrides` entries;
  `modules/index.ts` gains one import + one registry entry.
- **Applicable skills:** `onion-architecture`, `drizzle-orm-patterns`,
  `typescript-expert`.
- **Definition of done:** `pnpm arch:check` passes with the new module present;
  `pnpm typecheck` clean; container overrides let a test swap both ports.

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
  AC-8 is a signature-level guarantee, not a comment.
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
  Sub-cap first: admit spec docs in `sources[]` order while the running spec
  total stays ≤ `SPEC_INPUT_TOKEN_SUBCAP` (AC-27). Then, while over
  `BRIEF_INPUT_TOKEN_BUDGET`, apply AC-24's stages **in order**, whole items
  only: (1) drop spec excerpts whole-document from the lowest-priority
  (last-referenced) end; (2) drop the linked-issue block; (3) collapse hunk
  headers to `path (+a/-d)` lines; (4) reduce the changed-file list to the
  largest-by-(additions+deletions) N via a binary search on N (the `repo-map`
  budget-search precedent), always emitting the `+N more files not shown` marker.
  Every stage appends a human string to `dropped_inputs[]` (AC-26). If the floor
  alone exceeds the budget, return `{ floorExceeded: true }` — the caller makes
  **zero** calls (AC-25). Comment E-11 honestly: the tokenizer silently degrades
  to `ceil(chars / 4)` and is `cl100k_base` regardless of provider — this is a
  reproducible budget guard, not a provider-exact guarantee.
- **Applicable skills:** `typescript-expert`.
- **Definition of done:** an oversized fixture measures ≤ 8 000 after trimming;
  one assertion per stage proving the order and that no item survives partially;
  a floor-only-oversized fixture returns `floorExceeded` without producing
  messages.

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
- **Content:**
  - `getBrief(workspaceId, prId)` — resolve pull (404 via `NotFoundError` if
    outside workspace), read the row for the **current** `head_sha` →
    `state:'current'`; else newest row → `state:'stale'` naming the commit it
    describes (AC-17); else `absent`. Always `reused: true`, **zero** model calls
    (AC-1/AC-2/AC-12). Re-parse `json` against `Brief` on read; a `safeParse`
    failure yields `state:'corrupt'` with an honest reason instead of a throw
    (AC-40, E-19 — `onboarding/service.ts:293-311`'s exact pattern).
  - `generate(workspaceId, prId, { headSha, force }, log)` — capture
    `pull.headSha` **once**; refuse with `ConflictError` and zero calls if
    `headSha !== pull.headSha` (AC-16, E-6); if a row exists and `!force`, return
    it with `reused: true`, zero calls (AC-12); dedupe concurrent requests via
    `inFlight` keyed `${prId}:${headSha}` (E-5); read the persisted intent record
    and **never** classify — a missing or SHA-mismatched record degrades and is
    recorded as unresolved (AC-6, E-3, which also empties the spec input per
    D-10); read blast via
    `new BlastService(container.blastRepo, container).getBlastRadius(...)` — no
    `repoIntel` call, no model call (AC-7), degraded status carried into the
    prompt (E-4); resolve spec paths with `specPathsFrom(record)`
    (`intent-inputs.ts:194-198`) and re-read each fresh through
    `sources.readSpecFile` (AC-5, E-14/E-15); build → budget → **one**
    `llm.completeStructured` against a module-local response schema (the
    `IntentClassifierOutput` / `OnboardingLlmResponse` pattern), model from
    `resolveFeatureModel(container, workspaceId, 'risk_brief')`
    (`feature-models.ts:51-55`, AC-9); ground; persist via upsert (AC-13); return
    `{ record, reused: false }`. A throwing provider or a post-retry schema
    failure persists **nothing** and leaves any prior row for that SHA untouched,
    with no automatic retry (AC-42) — one `catch`,
    `onboarding/service.ts:202-222`'s shape. Outcome log carries prId, headSha,
    `inputTokens`, dropped-input and dropped-citation counts, provider/model,
    tokens, cost — and **never** diff bodies, spec contents, assembled input, or
    the raw response (AC-41).
  - `getTimeline(workspaceId, prId)` — all rows for the PR, newest-first, capped,
    plus `commit_count` from `pr_commits`; **zero** model calls (AC-14/AC-15).
  - `helpers.ts` (pure): `deriveBriefState`, `markRiskChanges` (AC-33 — compare
    each entry to the next-older), `mapRowToRecord`, `buildInputStatus`.
- **Applicable skills:** `onion-architecture`, `security`, `typescript-expert`,
  `zod`.
- **Definition of done:** `arch:check` clean; a `MockLLMProvider`
  (`adapters/mocks.ts:59,90`) records exactly one `completeStructured` and zero
  `complete` per generation, and zero of either on every read/timeline path.

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

### WI9 — Client data layer

- **Files/modules:** `client/src/lib/hooks/brief.ts` (new),
  `client/src/lib/hooks/index.ts`, `client/src/lib/types.ts`.
- **Content:** `usePrBrief(prId)`, `usePrBriefTimeline(prId, { enabled })` (lazy —
  only fetch when the timeline disclosure opens), `useGeneratePrBrief(prId)`
  writing the response back with `qc.setQueryData`. Structural copy of
  `hooks/onboarding.ts`. Re-export the new contract types from `lib/types.ts`.
- **Applicable skills:** `react-best-practices`, `next-best-practices`.
- **Definition of done:** `pnpm typecheck` clean; no component calls `fetch`
  directly.

### WI10 — i18n

- **Files/modules:** `client/messages/en/brief.json`.
- **Content:** add `card.*`, `focus.*`, `timeline.*`, `generate.*`, `inputs.*`
  subtrees. Do **not** touch or reuse `brief.why.*` (git-why's, D-3/AC-35) and do
  not redefine `title`, `unavailable`, `unavailableHint`, `block.*`, `noRisks`,
  `noHistory`, `overlap`, `viewBlast`. `unavailable` / `unavailableHint` stay in
  use for the *no-review* case inside the new card, so UX-1's two absences read
  differently: "no brief yet" (offers Generate) vs "no review yet" (no score
  gauge). The user-facing timeline label stays **"Why Timeline"** (D-3/UX-10)
  under the `timeline.*` key.
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
- **Applicable skills:** `react-best-practices`, `react-project-structure`,
  `next-best-practices`, `security`.
- **Definition of done:** `pnpm typecheck` and `pnpm test` clean (incl.
  `src/test/smoke.test.tsx`); no request fires on render of the empty state.

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
- **Applicable skills:** `react-best-practices`, `react-project-structure`.
- **Definition of done:** three briefs of differing risk levels render with
  exactly the expected change markers; the disclosure string is present.

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
  `DiffViewer` gains the same capability from scratch: controlled `open` state per
  file (via `FileCard`'s existing `open` / `onOpenChange`,
  `FileCard.tsx:42,55-56,69-72`) plus expand-then-`requestAnimationFrame`×2-then-
  `scrollIntoView` against `[data-diff-line="${path}:${line}"]`
  (`CodeLine.tsx:83`), so the link behaves identically in both order modes
  (E-22). Both viewers no-op safely when the path isn't in `files`.
- **Applicable skills:** `react-best-practices`, `react-project-structure`,
  `next-best-practices`.
- **Definition of done:** activating a focus entry lands on the right line in
  **smart** order and in **original** order; the params survive a remount; nothing
  scrolls when the path is absent.

### WI14 — Wire it into Overview + the AC-31 stale-file degrade

- **Files/modules:** `.../OverviewTab/OverviewTab.tsx`,
  `client/src/app/repos/[repoId]/pulls/[number]/page.tsx`.
- **Content:** swap `PrBriefBanner` → `PrBriefCard` in the existing full-width
  slot (`OverviewTab.tsx:33-47`), keeping `IntentCard | BlastRadiusCard`
  unchanged (Q-3 call). Thread `onFocusDiffLine` down from `page.tsx`, plus
  `changedFilePaths={pr.files.map(f => f.path)}` so `PrBriefCard` can check
  membership **before** navigating: a focus entry whose file isn't in the loaded
  data (because the PR advanced past the brief's `head_sha`) renders an
  explanatory disabled state and navigates nowhere (AC-31).
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

AC-38's rate-limit assertion requires enabling rate limiting explicitly inside
its test — it is fully disabled under `NODE_ENV=test` (`server/AGENTS.md`).

## Risks / Open questions

- **AC-38 may be untestable as written without a harness change.** Rate limiting
  is *disabled*, not relaxed, under `NODE_ENV=test`. If the app factory offers no
  per-test override, the honest outcome is a documented gap, not a fabricated
  assertion. Do not silently drop the AC.
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
- **The four Q-answers above are plan-level calls, not spec decisions.** Q-3 in
  particular is a layout/product call the spec deliberately declined; if the
  coordinator disagrees, only WI11/WI12/WI14 change, and the server half is
  unaffected.
- **`brief.unavailable` / `unavailableHint` semantics shift.** They currently mean
  *no review has run*; this plan keeps them meaning exactly that inside the new
  card. If a reviewer of the diff reads them as "no brief", the copy needs a
  rename — which would be a *new* key, never a redefinition (AC-35).
- **`INSIGHTS.md` correction the planner can't make itself** (planner write scope
  is `docs/plans/` only): the spec's Maintainability paragraph leaves open
  "whether that import is acceptable to the dependency-cruiser boundary check".
  It is — verified against `server/.dependency-cruiser.cjs`, which has no
  cross-module rule and no `reachable` rules. Worth recording in
  `server/INSIGHTS.md` at session end so the next module doesn't re-derive it.
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
exists.)*

1. **Is the `(pr_id, head_sha)` cache key race-safe under concurrent
   generation?** The plan stacks an in-process `inFlight` map (WI7) on a
   composite-PK upsert (WI2). Neither is a lock. Two API processes, or one
   process where the map key is computed from a `headSha` read *before* another
   request's read, still both pay for a call — the second's row simply overwrites
   the first's. Ask: is "duplicate spend, single row, last-writer-wins" the right
   failure mode, or does E-5 demand a real advisory lock, or an
   `INSERT … ON CONFLICT DO NOTHING`-then-poll? Note `server/AGENTS.md` already
   documents a single-API-process assumption (`reapStaleRuns()`), which this plan
   leans on without restating it as a limitation.
2. **Is AC-24's trim order the right priority ordering — and does this plan's
   sub-cap distort it?** The plan drops spec excerpts *first* (before the linked
   issue, before hunk headers) while simultaneously arguing under Q-5 that spec
   text is the input most likely to starve the file list. Those two positions are
   consistent only if spec text is genuinely the least valuable input. Is it? A PR
   that links its design doc is exactly the case D-10 says produces a better brief
   — and this order sacrifices that input first. Also check the plan's claim that
   read-time excerpting at 6 000 chars is "ingest, not AC-24 truncation": that
   reading is defensible but self-serving, and a reviewer should decide whether it
   honours AC-24's "never truncate an item mid-content" or quietly routes around
   it.
3. **Does AC-16's "current SHA only" leave the timeline usefully complete?** With
   no auto-generation (D-8) and no backfill (D-6), a typical PR yields one brief —
   the one generated the first time someone opened it — and the "Why Timeline" is
   a one-row list. The plan surfaces `brief_count` / `commit_count` to be honest
   about that (WI12), but honesty about emptiness isn't the same as usefulness.
   Ask whether the feature's second half has a real trigger to accumulate entries
   at all, and if not, whether that belongs in this iteration.
4. **Is the two-port split (`repository` + `sources`) proportionate, or
   ceremony?** WI3 introduces a second port purely so `service.ts` avoids
   `node:fs` and so one security test can assert a non-read. Compare against
   `OnboardingService`, which reaches for `new RepoRepository(container.db)`
   inside the service and is considered idiomatic here. A reviewer should say
   whether this plan is applying the `onion-architecture` skill or over-applying
   it.
5. **WI13 modifies a shared component
   (`client/src/components/diff-viewer/DiffViewer`) used outside this feature.**
   The plan treats that as incidental to a deep-link. Check whether the blast
   radius of adding controlled-open state to `DiffViewer` is understood, and
   whether AC-30 could be met without touching it.
