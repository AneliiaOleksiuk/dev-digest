# INSIGHTS — server

Accumulated engineering knowledge for this package: what worked, what didn't,
codebase-specific patterns, tool quirks, and open questions — kept OUT of
[AGENTS.md](AGENTS.md) under the ≤100-line / map-not-documentation rule.

Read at the start of every session per AGENTS.md, and updated at the end via
the `engineering-insights` skill — treat entries here as high-confidence
guidance unless AGENTS.md says otherwise. Append-only; entries must pass the
"cold read" test (actionable without re-investigation) — see
[../.claude/skills/engineering-insights/SKILL.md](../.claude/skills/engineering-insights/SKILL.md).

## What Works

- **Findings severity breakdown (critical/warning/suggestion counts) needed
  zero DB migration.** `server/src/modules/pulls/status.ts` already had a
  tested-but-unused `rollupSeverities(rows: {severity}[])` /
  `SeverityCounts` helper from an earlier, abandoned pass at this feature.
  Reused it as-is (no changes to it or its test
  `server/test/pulls-status.test.ts`) by adding one more `IN`-query against
  `t.findings` in both `modules/pulls/routes.ts` (PR list, keyed by the
  latest review's `reviewId`) and `modules/reviews/repository/run.repo.ts`'s
  `listRunsForPull` (per-run, keyed by `reviews.runId` joined to
  `findings.reviewId`) — mirrors the existing `costByRunId` "one more
  IN-query + JS grouping" pattern already in `pulls/routes.ts`. Unlike
  `findings_count`/`blockers` on `agent_runs`, these counts are **not**
  denormalized at run completion — computed live on every read instead,
  since the query is cheap at this list size and it avoided a schema change.
- **A fully synthetic demo PR (no real GitHub repo, no git clone needed) is
  a supported test path, not a hack.** `modules/reviews/diff-loader.ts`'s
  `loadDiff()` falls back to `diffFromPrFiles()` whenever
  `container.git.diff()` fails or returns no files — it reconstructs a
  `UnifiedDiff` from persisted `pr_files.patch` text. To create a working
  demo/eval PR against any repo (even one with `clone_path: null`, like the
  seeded `acme/payments-api`): insert one `pull_requests` row + one
  `pr_files` row whose `patch` column holds a hand-written unified-diff hunk
  (start at `@@ -a,b +c,d @@`, no `diff --git`/`---`/`+++` header lines —
  `diffFromPrFiles` adds those itself). `POST /pulls/:id/review` then works
  against it end-to-end, findings citations included. Confirmed working
  2026-08-02 for an API-contract-review experiment PR.

- **Re-adding per-run `cost_usd` needs zero `reviewer-core`/LLM-adapter
  changes.** `reviewer-core`'s `reviewPullRequest()`
  (`reviewer-core/src/review/run.ts`) and the server's `PriceBook`/
  `estimateCost` (`server/src/platform/price-book.ts`,
  `server/src/adapters/llm/pricing.ts`) already compute a real per-run USD
  cost on every LLM call and return it as `ReviewOutcome.costUsd`. A prior
  commit (`d45ab0d`, "remove per-PR/run cost, keep model pricing") only
  stopped `server/src/modules/reviews/run-executor.ts` from reading
  `outcome.costUsd` and dropped the `agent_runs.cost_usd` column + the
  `cost_usd` field from the `RunStats`/`RunSummary`/`PrMeta` contracts.
  Restoring/using per-run cost anywhere is purely: thread
  `outcome.costUsd` through `run-executor.ts` → `completeAgentRun()` →
  `agent_runs.cost_usd` → contracts — no new cost computation required.

## What Doesn't Work

- **"Skills-off will fully miss an obvious breaking API change" is not a
  safe assumption for a skills-off/skills-on demo.** Built an `API Contract
  Reviewer` agent (`openrouter`/`deepseek/deepseek-v4-flash`) with a
  deliberately generic system prompt and ran it against a PR that renames a
  JSON response field with no deprecation. Skills-off still flagged it
  CRITICAL (score 65) with a correct rationale — the base model is already
  competent enough to notice an obvious rename. Skills-on didn't newly
  "catch" it; it got *more precise* (named the violated rule —
  "breaking-change", "deprecation-policy" — by name, added a second
  distinct finding for the response-schema angle, scored it harsher: 30 vs
  65). If the goal is a hard miss/catch contrast rather than a
  precision/detail contrast, pick a subtler scenario (e.g. a request-field
  type narrowing, or a semver-bump-only violation with no field rename) —
  an obvious field rename is too easy for a modern model to need the skill.

## Codebase Patterns

- **PR-list `score` (and now `cost_usd`) is NOT an aggregate across
  reviewer agents.** `server/src/modules/pulls/routes.ts`'s
  `GET /repos/:id/pulls` picks the single most-recently-*created*
  `reviews` row (`kind='review'`) per PR (ordered by `createdAt` desc) and
  reads that one row's `score` (and, via its `runId`, the linked
  `agent_runs.cost_usd`). If several agents (e.g. Security + Performance
  Reviewer) reviewed the same PR, the list shows only whichever agent's
  review was persisted last — not a sum/average across agents. Any future
  per-PR aggregate field on this endpoint should follow this same
  "latest-review's-linked-run" semantics for consistency, unless a
  product decision explicitly asks for a different rollup (e.g. sum across
  all runs). The same "latest-review's-linked-run" semantics were used for
  the new `critical_count`/`warning_count`/`suggestion_count` fields added
  2026-07-30 — they're the severity breakdown of that SAME latest review,
  not summed across every agent/run on the PR.
- **`pnpm arch:check` (dependency-cruiser) only matches specific filenames
  — constructing a sibling module's concrete repository/adapter from
  inside a service passes it while still violating onion in substance
  (2026-08-14).** `.dependency-cruiser.cjs`'s four rules (`no-service-to-db`
  etc.) match `service.ts`/`routes.ts`/`helpers.ts` by name. `new
  RepoRepository(container.db)` called from `modules/onboarding/service.ts`
  (to look up a sibling module's row) is service→service on paper — the
  import path is `../repos/repository.js`, not `../../db/*` — so
  `arch:check` reports clean, even though transitively that pulls
  `drizzle-orm` and `src/db/schema` into the application layer exactly the
  way the rule exists to prevent. `plan-verifier`'s Phase 2 caught this
  reading the actual import graph, not the tool output. Same pattern
  already exists at `modules/conventions/service.ts:56`, also unexempt and
  also passing `arch:check`. If a new module needs data another module
  owns, put the read behind that module's own port/facade (the way
  `repoIntel.*` is meant to be consumed) rather than constructing its
  concrete repository class directly — `arch:check` won't catch the
  shortcut for you.
- **A module's file-I/O layer (the `facts.ts`/`discover.ts`-shaped file
  that keeps `helpers.ts` pure per the onion convention) is invisible to
  every `arch:check` rule (2026-08-14).** The four dependency-cruiser
  rules match only `service.ts`/`routes.ts`/`helpers.ts` by filename —
  `modules/onboarding/facts.ts` (which does real `node:fs/promises` I/O
  and takes the whole `Container`) is checked by none of them. Not a bug
  in this session's code, but worth knowing before assuming a green
  `arch:check` means every file in a new module was actually held to the
  boundary rules — it means every file *matching one of the four regexes*
  was.

## Codebase Patterns

- **`repoIntel.getConventionSamples(repoId, n)` (and `getTopFilesByRank`
  underneath it) return paths relative to the repo root as tracked in
  git** — confirmed live against the real cloned `devDigest` repo itself
  (paths came back like `server/src/platform/prompt.ts`, since this repo
  is a monorepo with no root `tsconfig.json`/`.eslintrc`). A consumer
  building its own file sample (e.g. `modules/conventions/service.ts`)
  must `path.join(repo.clonePath, path)` these directly — no re-rooting
  needed — but a naive "read well-known config filenames from the repo
  root" pass (`.eslintrc.json`, `tsconfig.json`, etc.) will legitimately
  come back empty against a monorepo like this one, since those configs
  live per-package (`server/tsconfig.json`, `client/tsconfig.json`), not
  at the root. That's expected, not a bug — don't "fix" it by guessing at
  package subfolders; it's a known limitation of a repo-root-only sample.

- **Vendored `trace.ts` copies already have pre-existing comment drift — do
  not "fix" it as part of unrelated work.** `server/src/vendor/shared/
  contracts/trace.ts` labels the callers/repo-map fields with lesson tags
  (`T1.3` / `T3`); `client/src/vendor/shared/contracts/trace.ts` labels the
  same fields `repo-intel`. The two copies are otherwise meant to stay
  byte-identical for contracts. Intent Layer added `PromptAssembly.intent`
  identically on both sides and did **not** widen this drift — leave the
  comment mismatch alone unless you're deliberately reconciling the whole
  vendor mirror.

- **Vendored `trace.ts` comment drift was reconciled 2026-08-13 (SPEC-01
  plan-verifier fix-loop).** The entry above is still correct for *unrelated*
  work: don't "fix" the comments as a drive-by. This session *was* the
  deliberate reconciliation — copy the server's more-specific `T1.3` / `T3`
  JSDoc onto the client copy (`callers` / `repo_map`). After that, `git
  diff --no-index -- server/src/vendor/shared/contracts/trace.ts
  client/src/vendor/shared/contracts/trace.ts` must be empty. Schema
  unchanged; comments only. Same rule as any other hand-mirror: edit both
  copies, then prove byte-identity with `--no-index`, not with a visual
  glance.

- **`GET /repos/:id/context` 404 is owned by `ProjectContextService.listDocuments`,
  not the route.** `routes.ts` must not call `contextRepo.getRepo` — that
  made the service's missing-repo branch unreachable over HTTP and put the
  HTTP layer on the port past its own application layer. Missing repo →
  throw `NotFoundError('Repo not found')`. No-clone (`clonePath` null) still
  returns the AC-3/E-1 degraded empty listing, never an error. Skill/agent
  404s stay in the route via `skillsRepo`/`agentsRepo`.

- **AC-15 and E-8 cannot be unit-tested at the service if the only filter
  lives in SQL.** `listForAgentEffective` still has `eq(skills.enabled, true)`
  and `eq(…repoId, repoId)` — that is the injection gate and must stay.
  To prove AC-15 at the service without ripping that SQL out: `EffectiveAttachmentRow`
  carries optional `enabled`, drizzle sets `enabled: true` on mapped rows,
  and `resolveEffectiveSet` skips `source === 'skill' && enabled === false`
  *before* dedupe/read. To prove E-8 run-log lines: a separate
  `listMismatchedForAgent` port returns other-repo paths (never injected);
  `resolveEffectiveSet` returns them as `mismatched: string[]`;
  `buildProjectContext` logs `project context: skipped (other repo) — ${path}`
  *before* the empty-set early return so a run that has only other-repo
  attachments still emits the lines and still omits the prompt slot (AC-21).

- **`RunTrace.specs_read` must only list paths opened *this run*.** Intent
  Layer reuses that field for intent-resolved spec paths (documented on the
  contract: pipeline reads, not necessarily prompt-fed). On a head-SHA
  cache hit, `getOrClassify` returns `{ reused: true }` and
  `run-executor` leaves `specs_read: []` — the cached record's
  `sources[].ref` still names those files, but this run did not open them.
  Populate via `specPathsFrom(record)` only when `reused: false`.

- **`repo-intel`'s caller cap MUST be applied per-`viaSymbol`, never globally
  — a shared helper prevents the two read paths from drifting.** WI1 of
  `docs/plans/l04-blast-radius-and-prepush-cli.md` found that
  `tryPersistentBlast` sorted+sliced its WHOLE `callers` array by rank before
  capping at `MAX_CALLERS_PER_SYMBOL` — a single fan-out changed symbol could
  starve every other changed symbol's callers down to zero — and the ripgrep
  fallback in `getBlastRadius` capped/sorted **nothing at all** (every row
  emitted with `rank: 0`, in discovery order). Fixed with one module-scope
  helper, `capCallersPerSymbol(callers, changedSymbols, cap)` in
  `modules/repo-intel/service.ts`: group by `viaSymbol`, sort each group by
  `rank` desc with a `file` asc / `line` asc tiebreak (the tiebreak matters
  most on the ripgrep path, where every rank is 0), slice to `cap`, then
  concatenate groups in `changedSymbols` order — called identically from both
  `tryPersistentBlast` and the ripgrep path so they can't re-drift. Test:
  `server/test/repo-intel-blast-cap.test.ts`.
- **A route that needs the repo-intel facade but isn't `repo-intel/` itself
  should still live in its own module** — `modules/blast/` (L04,
  `GET /pulls/:id/blast`) calls exactly two facade methods
  (`repoIntel.getBlastRadius` + `repoIntel.getIndexState`, in parallel) and
  is otherwise a normal onion module (`routes.ts`→`service.ts`→
  `repository.ts`←`repository.drizzle.ts`), copied from `smart-diff/`'s
  shape. **Update, 2026-08-09 (L04 acceptance fix):** `tryPersistentBlast`
  now also walks `file_edges` in reverse (imported → importers) up to
  `BFS_DEPTH` (2) and merges those dependents' `file_facts` into
  `factsByFile` / `dependentFilesByDeclFile` so endpoints on modules that
  import the changed file (not only direct symbol callers) surface in
  `GET /pulls/:id/blast`. Pure index read — no AST rebuild on the request.
  See `reverseImportReach` + `server/test/repo-intel-blast-reverse.test.ts`.
- **When `references.decl_file` is NULL for an otherwise full index, blast
  still surfaces callers via name match.** `getResolvedCallers` requires
  `decl_file ∈ changedFiles`; if the import graph never resolved
  (`file_edges` empty / unmatched imports), that query returns `[]` even
  though `references` rows exist. `tryPersistentBlast` then falls back to
  `RepoIntelRepository.getNameMatchedCallers` (left-join `file_rank`,
  coalesce rank 0) and drops rows whose `fromPath` is a declaring file of
  that symbol. Confirmed live on demo PR #3 (`rateLimit` → 4 callers +
  endpoint badges) after checking out the PR tip into the clone and full-
  indexing. Caveat: common names (`push`, `get`, …) inflate callers until
  `decl_file` resolution works. Test: name-matched case in
  `server/test/repo-intel-blast-reverse.test.ts`.
- **`status: 'partial'` gets its own client-facing warning even though
  `RepoIntelRepository.tryGetIndexState` itself does NOT treat `partial` as
  degraded** (`stats.status === 'degraded' || 'failed'` is the only
  `degraded: true` trigger there — see the entry below this one). L04's
  `BlastRadiusResponse.status` derivation (`modules/blast/helpers.ts`,
  `deriveStatus`) is a **deliberate product decision, not a mechanical
  passthrough**: `degraded` when `blast.degraded` or the index status is
  `degraded`/`failed`; **`partial` renders its own banner** (not silently
  folded into "full") whenever the index status is `partial`; `full`
  otherwise. If another repo-intel consumer is tempted to reuse
  `tryGetIndexState`'s "partial is still fine" framing for a new
  user-facing feature, confirm that's actually wanted first — L04 chose the
  opposite for Blast Radius.
- **`BlastRadiusResponse` (`contracts/review-api.ts`) extends the existing
  `BlastRadius` from `contracts/brief.ts`** (`BlastRadius.extend({status,
  reason})`) — same pattern as `SmartDiffResponse = SmartDiff`. Do **not**
  add a `rank` field to `BlastCaller`; it's shared with the still-unbuilt
  `PrBrief`, and ordering is already carried by array order (rank-sorted
  server-side by the `capCallersPerSymbol` fix above).
- **`BlastRepository` grew a third port method** (2026-08-09, L04
  follow-ups): `getPull`/`getPrFiles` were joined by `getPriorPrsForFiles`
  (`repository.ts`/`repository.drizzle.ts`) — a `pr_files ⋈ pull_requests`
  aggregate join (`groupBy` + `count(distinct path)`) answering "which other
  PRs touched these same files," capped by `MAX_PRIOR_PRS`/
  `MAX_PATHS_FOR_PRIOR_PRS` in `modules/blast/constants.ts`. Ordered on
  `pull_requests.number` (`notNull`, unique per repo), not on
  `opened_at`/`updated_at` (both nullable) — a correct recency proxy that's
  also deterministic. `prior_prs: PriorPr[]` was added to
  `BlastRadiusResponse` as **required** (not optional): the service always
  produces it, `[]` on the degraded/no-files path, so an optional field
  would only add `?.` at every read site for no honesty gain. `pr_files` has
  **no index on `path`** — fine at this app's local-first scale with the
  path-count cap; if it ever needs one, generate it
  (`pnpm db:generate` → `pnpm db:migrate`), never hand-edit
  `src/db/migrations/**`. Deliberately **not** exposed through the MCP
  `get_blast_radius` tool (`mcp/src/project.ts`'s `toBlastRadiusOutput`
  keeps its explicit field list, so adding a contract field can't leak
  through by accident) — "who touched these files before" is a UI
  affordance, not something a reviewing model needs, and `mcp/AGENTS.md`'s
  token-frugality principle argues against spending output tokens on it.
- **`repo-intel`'s endpoint/cron detection used to be DIRECT callers only;
  L04 acceptance fix superseded that.** Older note: `tryPersistentBlast`
  resolved only DIRECT callers via `references.decl_file`, then read
  `file_facts` for those caller files — no importer walk. **Update,
  2026-08-09:** reverse `file_edges` BFS (`BFS_DEPTH` = 2) merges dependents'
  facts, and when `decl_file` is unresolved the name-matched caller fallback
  still feeds `file_facts` for those caller paths. Do not re-assert "one hop
  only" from README prose written before that fix.
- **`PrIntentRecord` (`review-api.ts`) picks up new `Intent` fields for free
  via `Intent.extend({...})`** — adding `risk_areas: z.array(z.string())
  .default([])` to the base `Intent` schema in `brief.ts` required zero
  changes to `PrIntentRecord`'s own definition; only the repository's manual
  object-literal construction sites (`getIntent`/`getIntentRecord` in
  `repository/pull.repo.ts`) needed the new field added by hand, since those
  build a plain TS object rather than calling `.parse()` — a manually-typed
  return object doesn't get Zod's `.default()` for free the way a real parse
  call does. When extending a base contract like this, grep for every
  hand-built object literal typed against the *extended* schema, not just
  the base one.

- **A shared pure write-guard module composes better than one method per
  gate.** `modules/project-context/write-guards.ts` (SPEC-01 amendment,
  AC-35/AC-36/AC-43/AC-45/AC-47) splits into `validateDocPathShape` (no
  filesystem/config — extension, `.`/`..`, separator, absolute/drive/UNC
  form, charset, depth/length caps) and `resolveWritablePath` (shape → first
  path segment ∈ configured roots → no segment in `EXCLUDED_DIRS` →
  `isInsideClone`), each returning `{ ok: true, ... } | { ok: false, reason
  }` instead of a boolean. Both `saveDocument` and `createDocument` in
  `service.ts` call the SAME `resolveWritablePath`, so a rule added there
  can't silently apply to only one write path. `isInsideClone`
  (`reviews/intent-inputs.ts:138`) is a containment check only — a path
  under `.git/hooks/` resolves inside the clone just fine, so it is
  deliberately the LAST gate, not a stand-in for the whole chain.
- **Content-hash staleness token, not mtime, for a concurrent-edit check on
  win32.** `helpers.ts`'s `revisionOf(buf)` (sha256 hex) backs AC-37's "save
  rejected if the file moved since the editor read it": `GET
  .../context/document` returns it, the client sends it back on `PUT`, and
  `saveDocument` re-reads + re-hashes right before the write. An mtime was
  rejected — this dev environment is win32, where a same-tick out-of-band
  write can share an mtime with the read that preceded it, defeating the
  check exactly when it matters.
- **A vendored port interface (`GitClient`) can drift between the server and
  client mirrors even though the "hand-mirror on every edit" rule says it
  shouldn't.** Discovered while doing the SPEC-01 amendment's `sync()`
  docblock mirror (WI5): `client/src/vendor/shared/adapters.ts`'s
  `GitClient` was already missing `sync`, `diffNameOnly`, and several
  unrelated interfaces (`CommitFilesPayload`, `commitFiles`, `findOpenPr`,
  the `sessionId` field, the `'openrouter'` provider literal) that the
  server copy has — pre-existing drift, not something this session caused.
  `GitClient` has ZERO consumers anywhere in `client/src` (confirmed by
  grep), so nothing broke. Fixed only the one method this session's DoD
  required (`sync` + its docblock, added to the client interface); the rest
  of the drift is still there — don't assume the client `adapters.ts` mirror
  is otherwise in sync with the server one.

- **A Zod contract state enum can mix persisted and deliberately-transient
  values without the transient ones ever touching a repository write
  (2026-08-14, SPEC-03 `BriefState`).** `BriefState = 'current' | 'stale' |
  'absent' | 'corrupt' | 'budget_exceeded' | 'failed'` — the first four are
  READ states, always derivable from row-presence + a `safeParse` outcome
  (`modules/brief/helpers.ts`'s `deriveBriefState`); the last two are
  GENERATE-ONLY outcomes AC-25/AC-42 require to never be persisted (a
  floor-exceeded budget check makes zero calls; a failed/schema-invalid call
  must leave any prior row untouched). Implementation: `BriefService.generate`
  constructs `budget_exceeded`/`failed` as literal `BriefResponse` objects
  directly inside its budget-check and `catch` branches — never round-tripped
  through `BriefRepository.upsertBrief`. Keeps "a corrupted stored row
  degrades on read" (the `onboarding.json` pattern, `mapRowToRecord`
  returning `null`) fully separate from "this one attempt failed" — the two
  read as the same shape to the client (`record: null`, a `reason` string)
  but have entirely different code paths and different persistence
  consequences. Worth this shape for any future feature with a similarly
  strict "some outcomes must produce zero DB writes" requirement.

- **Extending a Zod contract with a REQUIRED new field is the expensive move
  when that contract's test fixtures live in a do-not-touch tree you can't
  fix yourself (2026-08-23, SPEC-04 fix-loop iteration 1).** Adding
  `AgentColumn.error: z.string().nullable()` (both vendor
  `contracts/observability.ts` copies) broke `cd client && tsc --noEmit`
  with `TS2741`/`TS2719` on multiple hand-built `AgentColumn` object literals
  in test fixtures under `client/src/app/repos/[repoId]/multi-agent/**` —
  exactly this fix-loop's explicit do-not-touch tree (a parallel client
  fix-loop agent + test-writer were working there concurrently). Fixed by
  using `.nullish()` instead of `.nullable()` — already an established
  convention in this SAME file for a field that legitimately isn't present
  on every row (`AgentColumnFinding.kind`, `FindingGroupMember.suggestion`) —
  which made every pre-existing hand-built `AgentColumn` literal typecheck
  again with zero client-side edits, since the field became optional rather
  than required. `multi-agent-read.ts` still always explicitly sets it to a
  real string or `null` (server behavior unaffected) — only the TYPE became
  more permissive. Before assuming a nullable-string field on a shared
  contract must be `.nullable()` (required), check whether `.nullish()` is
  already a precedented pattern in that same file when test fixtures you
  can't touch are a real constraint.
- **`deriveConflicts` (`multi-agent-derive.ts`) used to pre-filter its
  emitted array down to AC-30 "genuine conflict" entries only — this makes
  a REQUIRED "OFF = show every shared location" toggle state impossible to
  ever implement client-side**, since non-conflicting locations never leave
  the server (fixed 2026-08-23, SPEC-04 fix-loop iteration 1: now emits
  every location in the per-location index unconditionally; no contract
  change needed, since every `Conflict.takes[]` entry already carries
  severity-or-`'ignored'` per participating agent, everything a consumer
  needs to compute AC-30 locally). General lesson: a "derive X for display"
  function that ALSO decides what counts as noteworthy is doing two jobs —
  when a caller needs both "everything" and "the interesting subset," split
  those two decisions instead of baking the filter into the deriver.
- **A one-line addition to an ALREADY-drifted hand-mirrored vendor file
  (server vs. client `contracts/knowledge.ts`, drift documented 2026-08-14:
  server has `AgentVersionConfig`/`AgentVersion`, client doesn't; shorter
  `Provider`/`CiFailOn` comments on the client side) cannot be verified with
  a plain `git diff --no-index` on the whole file — that will never be
  empty here.** Verify with a diff-of-diffs instead (2026-08-23): capture
  `git diff --no-index` between the two files BEFORE your edit, capture it
  again AFTER, and confirm the only change between the two captures is your
  new hunk (for a single-token widening like `EvalOwnerKind` gaining
  `'finding'`, that's literally just the git blob-index line changing).
  Proves you introduced zero NEW drift without requiring the pre-existing
  drift to vanish — same technique the 2026-08-14 onboarding-contracts
  session used, worth citing by name next time this file needs touching.
- **A plain (non-partial) unique index on a nullable Drizzle column is the
  right tool for "idempotency key that not every row has" — no
  partial/WHERE-clause index needed (2026-08-23, `memory.learnedFindingId`,
  Learn-action idempotency fix).** Postgres treats NULLs as pairwise-distinct
  under a standard unique index, so rows that never set the column (manual
  memory entries, non-Learn-originated rows) never collide with each other
  or with a real learned-finding id. This repo's schema files have zero
  existing precedent for a partial/`WHERE`-clause unique index — don't reach
  for one reflexively when the plain form already gives correct semantics.
  Paired with a DB-level TOCTOU fix for `eval_cases` too (plain uniqueIndex
  on `(workspace_id, owner_kind, owner_id)`) — both `insertMemory`/
  `insertEvalCase` (`repository/knowledge.repo.ts`) now try/catch the
  resulting unique-violation and re-fetch+return the existing row on a race,
  turning the constraint into a REAL idempotency guarantee (concurrent
  double-submit safe) instead of a crash-on-race. The old
  `finding:<uuid>`-embedded-in-`sources[].context` token-scanning approach
  (`findMemoryByToken`) was deleted outright, not kept as a fallback — the
  new dedicated column is strictly better and the old approach had no
  remaining callers.
- **`onion-architecture`'s `rules/dependency-rule.md` table says `service.ts`
  must never import `platform/container.ts`, but the real, already-shipped
  precedent contradicts the table and IS the pattern to follow
  (2026-08-20, L06-Evals Phase B, `modules/eval/service.ts`).**
  `modules/blast/service.ts` (a genuinely new, post-skill module cited
  elsewhere in this file as "otherwise a normal onion module") takes
  `Container` in its constructor and calls `this.container.repoIntel...`
  directly — `examples.md`'s own "good" `XService` example, by contrast,
  takes only the repository interface, no `Container`. When a new module's
  service needs to construct a SIBLING module's `Service` class for a
  cross-module read (the skill's own sanctioned "depend on the owning
  module's `service.ts`, not its `repository.ts`" rule), that construction
  has to happen somewhere, and the working examples in this codebase
  (`brief/sources.node.ts:45` constructing `BlastService`, and now
  `eval/service.ts` constructing `AgentsService`) all do it by threading
  `Container` through, not by trying to avoid importing `Container` at all
  costs. Followed the real precedent (Container in the constructor, used
  only to build peer `*Service` instances or read cross-cutting facades like
  `repoIntel`) rather than the stricter written table — `arch:check` stayed
  green either way, since none of the four dependency-cruiser rules actually
  forbid `service.ts → platform/container.ts` (only `db/schema|client`,
  `adapters/`, and — for `helpers.ts` only — `container.ts` itself are
  matched). If a future session tightens `dependency-rule.md`'s table to
  match this practice (or adds a fifth dependency-cruiser rule to actually
  enforce the stricter table), don't be surprised that `blast/service.ts`
  and `eval/service.ts` both need it grandfathered or rewritten.
- **Re-implementing a cross-module join locally (per onion's "Cross-module
  reads" rule) is mechanical, not risky, when the source function is a plain
  `db.select()` chain (2026-08-20, `modules/eval/repository.drizzle.ts`'s
  `getFindingContext`).** `modules/reviews/repository.ts`'s `findingContext`
  (three sequential `getFinding`/`getReview`/one inline `pull_requests`
  select) and `modules/reviews/diff-loader.ts`'s `diffFromPrFiles` (a
  four-line-per-file `diff --git`/`---`/`+++`/patch text builder) were both
  copied in SHAPE, not imported, into `modules/eval/`'s own
  `repository.drizzle.ts` (`getFindingContext`) and `helpers.ts`
  (`buildDiffText`) respectively — neither original function was touched.
  Both are ~10-15 lines of straight-line Drizzle/string-building code with no
  hidden behavior, so the duplication is a one-time cost, not an ongoing
  maintenance burden; if `diffFromPrFiles`'s four-line format ever changes,
  grep for the literal `diff --git a/` string to find every place that needs
  updating in lockstep (currently 2: the original and this mirror).

- **The Agents module's update route is `PUT /agents/:id`, not `PATCH`**
  (`modules/agents/routes.ts:109`) — every other module touched by L06-Evals
  (`eval-cases`, etc.) uses `PATCH` for its own partial-update route, so it's
  an easy wrong guess to carry over when writing a cross-module test/script
  against agents. `POST /agents`/`DELETE /agents/:id` are the usual verbs;
  only the update route is the outlier.
- **`EvalDashboard.delta`'s three metric fields are plain non-nullable
  `z.number()`s in the committed Phase-A contract, unlike
  `EvalComparison.delta`'s fields, which ARE individually nullable
  (2026-08-21, WI8, `modules/eval/service.ts`'s `buildDashboard`).** Once
  `buildDashboard` decides to render a delta block at all (>=2 batches for
  the same owner), every one of `recall`/`precision`/`citation_accuracy` must
  be a real number — there is no per-field null escape hatch the way
  `EvalComparison.delta`'s schema allows. The chosen compromise (documented
  inline at the computation): when either endpoint batch's OWN metric is
  null (e.g. a batch whose cases had zero `must_find` entries, so `recall`
  is genuinely unmeasured), report `0` for that delta field rather than
  subtracting against a fabricated non-null baseline — the latter would read
  as a false swing ("recall dropped by 0.8") when the truth is "unmeasured
  this batch," which is strictly worse. `EvalComparison`'s own delta (WI8's
  `compare()` method) does NOT have this problem — use `null` there whenever
  either side's metric is null, since the schema allows it. If a future
  session widens `EvalDashboard.delta`'s fields to `.nullable()` to close this
  gap, `buildDashboard`'s `0`-fallback branch should be replaced with a real
  null at the same time — don't leave both paths inconsistent.
  **STALE as of 2026-08-21 (Phase C `plan-verifier` fix-loop, Major finding
  #2) — the gap above is now closed, not just documented as a tradeoff.**
  `EvalDashboard.delta`'s three fields were widened to `.nullable()` in BOTH
  vendored `eval-ci.ts` copies, and `buildDashboard`'s `0`-fallback branch was
  replaced with `latest.x !== null && previous.x !== null ? latest.x -
  previous.x : null` per field — exactly the fix this entry's last sentence
  anticipated. The `0`-fallback code this entry describes no longer exists;
  don't reintroduce it from memory of this entry alone, check the current
  `service.ts`. Confirmed zero client consumers of `EvalDashboard.delta`
  existed before the widening (`grep -r "delta" client/src` hit only
  `MetricCard`'s own unrelated generic `delta` prop and a `Showcase` demo
  usage), so this contract ripple needed no client-side fixture update —
  unlike the `project_context_docs`/`risk_areas` ripples documented
  elsewhere in this file.

## Tool & Library Notes

- **This repo has no ESLint config anywhere** — not in `server/`, `client/`,
  `e2e/`, or `reviewer-core/` (checked all four for `.eslint*`/`eslint.config.*`,
  found none, and there's no root `package.json` either since this isn't a
  monorepo). Before reaching for an ESLint plugin to enforce a convention
  (e.g. `eslint-plugin-boundaries` for architecture rules), check whether a
  zero-new-dependency alternative exists first — bootstrapping ESLint from
  scratch just to get one plugin is a much bigger lift than it looks.
- **`dependency-cruiser` (^17.4.3) is already a `server` runtime dependency**
  — used programmatically by `adapters/depgraph/index.ts` (`DepCruiseGraph`)
  to build the dep-graph for the repo-intel feature on *reviewed* repos. It
  can also be run as a CLI against this repo's own `server/src` (added
  2026-08-01: `server/.dependency-cruiser.cjs` + `pnpm arch:check`, see
  `.claude/skills/onion-architecture/rules/enforcement.md`). Its
  `forbidden` rules match individual import edges (`from.path` → `to.path`
  regex) — there's no built-in way to express "two different kinds of
  import in the same file" (e.g. "only `container.ts` may import both a
  port and its concrete adapter") as a single rule; that has to stay a
  code-review checklist item instead.
- **`dependency-cruiser`'s resolved path for an npm dependency keeps the
  `node_modules/` prefix** (e.g. `node_modules/drizzle-orm/index.js`) even
  with `doNotFollow: { path: 'node_modules' }` set — confirmed by writing a
  rule matching `to.path: 'node_modules/(drizzle-orm|postgres)/'` and seeing
  it correctly flag a test import. `doNotFollow` stops it recursing *past*
  that edge (for speed), it doesn't change how the edge itself is reported.

- **A cheap/free OpenRouter model (`deepseek/deepseek-v4-flash`) can emit a
  stray NUL byte (` `) inside a JSON string field of an otherwise-valid
  structured output.** Postgres `text` columns reject NUL bytes outright
  regardless of encoding — a Drizzle insert containing one fails with
  `invalid byte sequence for encoding "UTF8": 0x00`, not a schema-validation
  error (the JSON itself parses fine against the Zod schema; the byte only
  breaks on the DB write). Fix at the repository/adapter boundary, not the
  service layer, so it protects every caller: see
  `modules/conventions/repository.drizzle.ts`'s `removeNulBytes()`,
  applied to every LLM-derived string field in both `insertMany` and
  `update`. **Tool gotcha hit while fixing this**: writing a literal
  ` `/`\0` regex escape via the Edit/Write tools produced an actual
  raw NUL byte in the source file instead of the four-character escape
  text (broke the file, `Edit`'s `old_string` then couldn't match it
  either). Use `String.fromCharCode(0)` in source instead of any NUL/`\0`
  escape literal.
- **Per-feature LLM provider/model overrides
  (`resolveFeatureModel`/`Settings.feature_models`,
  `modules/settings/feature-models.ts`) are the correct fix when one
  provider's key is exhausted but you need a specific feature (e.g.
  `'conventions'`) working right now** — `PUT /settings` with
  `{"feature_models":{"<featureId>":{"provider":"openrouter","model":"..."}}}`
  reroutes just that feature without touching code or the registry
  default. Confirmed live 2026-08-02 that this local environment's OpenAI
  key was over its billing quota (`429`) and the Anthropic key had
  insufficient credit (`400`, low balance) — only `openrouter` worked;
  `POST /settings/test-connection` is the fast way to check which
  provider(s) are actually usable before debugging "why did my LLM call
  fail" as if it were a code bug.

- **`adapters/tokenizer` is DI-generic, not repo-intel-only.** Its docblock
  previously said the adapter was "ONLY under modules/repo-intel". Intent
  Layer's `IntentService` (`modules/reviews/intent-service.ts`) calls
  `container.tokenizer.count(...)` for the classifier-call log line's token
  estimate. That is a valid use — the port is DI-provided via
  `Container.tokenizer` and swappable in tests; the old wording was a stale
  scope comment, not an architectural boundary. The comment in
  `server/src/adapters/tokenizer/index.ts` was widened accordingly; do not
  re-narrow it or invent a reviews→repo-intel dependency to "fix" the call.

- **`fs.readFile(path, 'utf8')` does not throw on invalid UTF-8.** Node
  (this repo's floor is ≥22) decodes with U+FFFD replacement characters,
  so a `.catch(() => null)` never fires for a binary `.md` and the garbage
  string gets injected. SPEC-01 E-5 ("skip like E-2, do not throw") needs
  a Buffer read plus `isUtf8` from `node:buffer` (no extra dependency):
  `readUtf8OrNull` in `modules/project-context/helpers.ts` returns `null`
  for missing/unreadable/non-UTF8; `resolveEffectiveSet` pushes that path
  onto `skipped[]`. Do not "fix" E-5 by catching a decode throw — there
  isn't one. `listDocuments` / `getDocument` still use `'utf8'` on
  purpose (listing/preview is not E-5's contract).

- **`simple-git`'s typed API has no `status --porcelain` passthrough that
  returns the raw string** — `SimpleGit.status()` returns a parsed
  `StatusResult` object, not the porcelain text AC-50 asks for
  (`git status --porcelain --untracked-files=all`). Used
  `g.raw(['status', '--porcelain', '--untracked-files=all'])` instead
  (`adapters/git/simple-git.ts`'s `sync()`) and hand-parsed the fixed-width
  `XY PATH` porcelain-v1 line format (`slice(3)` for the path, `' -> '` split
  for a rename) rather than reaching for `StatusResult`, which would need a
  second `status()` call anyway (this one already gates the fetch/reset that
  follows it).

- **The `postgres` npm driver (`db/client.ts`'s `createDb`) surfaces a
  Postgres `unique_violation` as `err.code === '23505'` on the thrown
  error** (2026-08-23, SPEC-04 fix-loop iteration 1 — no prior code in this
  repo checked a Postgres error code before this session, confirmed by
  grep). Used to turn a DB-level unique index into a real concurrent-race
  idempotency guarantee: `insertMemory`/`insertEvalCase`
  (`modules/reviews/repository/knowledge.repo.ts`) try/catch the insert,
  check `err.code === '23505'`, and re-fetch+return the row the OTHER
  concurrent request just committed, instead of letting the constraint
  violation bubble up as a raw 500. If a future feature needs the same
  "DB constraint as idempotency guarantee, not just a crash-preventer"
  shape, this is the exact error-code check to reuse.
- **pgvector column dimension mismatch after embedding model change silently
  returns zero rows (2026-08-20).** When switching embedding models (e.g.,
  OpenAI `text-embedding-3-small` 1536-dim → a different provider's 3072-dim),
  the pgvector column's vector-dimension constraint stays at the OLD size.
  Subsequent queries with embeddings of the NEW dimension silently return empty
  results — no SQL error, no type error, just no matching rows. The cause is
  hidden inside pgvector's distance-computation internals: a vector of
  dimension 3072 cannot compute distance against a column defined as dimension
  1536, so the WHERE clause silently matches nothing. **Fix:** after changing
  the embedding model, regenerate and apply a fresh Drizzle migration — `pnpm
  db:generate` (inspect the resulting `migrations/*.sql` to confirm the
  column's `vector(n)` constraint changed to the new dimension), then `pnpm
  db:migrate`. The dimension is baked into the column's type definition at the
  DDL level; the database will not auto-adapt it. **Prevention:** Store the
  embedding model name and expected dimension in a schema comment or Drizzle
  migration so a future model change surfaces the mismatch during code review:
  `// Embedded with OpenAI text-embedding-3-small (1536-dim)` on the column
  definition. This is especially subtle because a local schema mismatch won't
  surface until you actually run a query — typecheck and connection testing both
  pass silently.
- **The two vendored `eval-ci.ts` copies had pre-existing byte-drift before
  L06-Evals touched them (2026-08-20).** `client/src/vendor/shared/contracts/
  eval-ci.ts` was missing `AgentManifest`/`AgentManifestInput` entirely, only
  imported `Provider`/`CiFailOn` implicitly via that missing export, and
  `ConformanceInput.provider`'s enum lacked the `'openrouter'` variant the
  server copy has — none of it exercised anywhere in `client/src` (grep
  confirmed zero references to `AgentManifest`), so it never surfaced as a
  bug. `docs/plans/eval-pipeline.md` WI1's Definition of done requires `git
  diff --no-index` between the two files to print **nothing**, which this
  drift would have failed regardless of the new eval-batch content being
  correct on both sides. Fixed by copying the server file's full content
  (old + new) onto the client file rather than patching only the new
  sections — confirmed with the same `--no-index` command afterward. If a
  future session edits `eval-ci.ts` again, run that diff BEFORE starting, not
  just after, so pre-existing drift doesn't get silently attributed to the
  current change.
- **`drizzle-kit generate` did NOT prompt interactively for a pure-ADD schema
  change spanning two tables (2026-08-20, `eval_batches` + `eval_runs.batch_id`).**
  The documented `ADD+DROP-in-one-run` interactive-prompt gotcha (below, `pnpm
  db:generate` entry) only fires when one run both drops and adds columns on
  the SAME table. A new table (`eval_batches`) plus a new nullable FK column
  on an existing table (`eval_runs.batch_id`) plus two new indexes — all pure
  additions, no renames/drops anywhere in the diff — generated cleanly in one
  non-interactive run with no rename-vs-create ambiguity. Don't pre-emptively
  split an all-additive migration into two `db:generate` runs "just in case";
  the two-pass workaround is only needed when a rename could plausibly be
  inferred.
- **The `.default([])` vs. explicit-`null` Zod gotcha (documented above for
  `AgentManifest.skills`, a YAML-authored field) recurs identically for a
  genuinely nullable DB column, not just a YAML-parsed one (2026-08-20,
  plan-verifier Phase 2 fix pass on `docs/plans/eval-pipeline.md`).**
  `eval_batches.skills_fingerprint` was `jsonb('skills_fingerprint')` with no
  DB default — a real NULL row — while `EvalBatchRecord.skills_fingerprint`
  was `z.array(...).default([])`. `.default()` only fires when the KEY is
  absent from the parsed object; a Drizzle-read row always has the key
  present (value `null`), so `EvalBatchRecord.safeParse` failed on a
  genuinely-empty-fingerprint row instead of degrading to `[]`. Fixed the
  same way as `AgentManifest.skills`: `.nullish().transform((v) => v ?? [])`
  on the Zod side (both vendored `eval-ci.ts` copies, kept byte-identical),
  PLUS closed it at the DB layer too — `.notNull().default(...)` with a
  raw-SQL `'[]'::jsonb` default expression on the column (same pattern as
  `prIntent`'s `inScope`/`sources`/etc. in
  `db/schema/reviews.ts`) — so a future row can't reintroduce the NULL this
  contract now tolerates but shouldn't rely on. If you see `.default([])`
  guarding a jsonb array field anywhere else in `eval-ci.ts` (or any other
  contract file), grep the matching Drizzle column for whether it's
  `.notNull()` — if not, the same silent-`safeParse`-failure risk applies
  even though no bug report will mention "Zod" or "`.default()`" by name.
- **Combine every open schema fix into ONE `pnpm db:generate` run, even
  across unrelated tables, rather than one run per fix (2026-08-20).**
  Fixing `eval_batches.skills_fingerprint`'s nullability AND adding
  `eval_runs.findings_total`/`eval_runs.error` (two unrelated Major findings
  from the same `plan-verifier` Phase 2 pass) in the same schema edit before
  running `db:generate` produced one migration
  (`0020_early_korvac.sql`) instead of two — halves the
  journal/snapshot bookkeeping surface that the 2026-08-14 "three artifacts,
  commit all three" incident (below) warns about, with no downside since
  neither fix depended on the other applying first. Verified this migration
  both incrementally (`pnpm db:migrate` against the already-migrated dev DB)
  and via a full from-scratch replay (`CREATE DATABASE
  devdigest_replay_check` in the same Postgres container, then `DATABASE_URL=
  ...devdigest_replay_check pnpm exec tsx src/db/migrate.ts` runs migrations
  0000→0020 in order) — both applied cleanly with zero manual SQL edits,
  confirming `SET NOT NULL` on `skills_fingerprint` was safe (checked first
  via `SELECT count(*) FROM eval_batches WHERE skills_fingerprint IS NULL`
  → 0 rows in the live dev DB before running it).

- **A raw `db.insert(t.agents).values(...)` (bypassing `AgentsRepository
  .insert()`) creates an agent with NO `agent_versions` snapshot for version
  1 — only `AgentsRepository.insert()`'s own `snapshotVersion()` side effect
  writes that row (confirmed 2026-08-21, WI7/WI8 manual verification against
  real Postgres).** A test or script that inserts an agent directly via
  Drizzle and then calls `AgentsService.getVersion(workspaceId, agentId, 1)`
  gets `undefined` — which is the CORRECT "missing snapshot" degradation
  (AC-32, `modules/eval/service.ts`'s `compare()`: a missing snapshot yields
  a `null` prompt, never the live one), not a bug in `getVersion` or in the
  eval compare view. Easy to misdiagnose as a compare-view bug when it's
  actually a test-fixture gap. Create the agent through `POST /agents` (or
  `AgentsRepository.insert()` directly) whenever a version-1 snapshot needs
  to actually exist.
- **An "open with placeholder, close with real aggregate" two-step INSERT
  makes the placeholder row a real read-path hazard, not just an internal
  implementation detail — fixed by deferring the whole write to close time
  (2026-08-21, Phase C `plan-verifier` fix-loop, Major finding #1,
  `modules/eval/{repository,repository.drizzle,service}.ts`).** WI7 as
  originally shipped wrote an `eval_batches` row at batch-OPEN (before any
  case had run) with placeholder aggregates (`status: 'failed'`,
  `cases_total: 0`, every metric `null`), then overwrote it via a separate
  `closeBatch` once the real aggregate was known. The doc comment claimed
  this was never read back by a caller — false: `listBatchesForOwner` has no
  status filter and sorts `ran_at` desc, so the placeholder WAS `batches[0]`
  (the "latest" batch) for the ENTIRE in-flight window — a concurrent
  `GET /agents/:id/eval-dashboard` mid-run saw `current.*` all null,
  `cases_total: 0` for an agent with real history, and computed a fabricated
  `delta` against real prior data. Worse: a process dying mid-batch left a
  PERMANENT fake-failed row indistinguishable from a genuine AC-21
  all-failed batch. **Fix:** merged `insertBatch`+`closeBatch` into one
  `insertClosedBatch` — the batch row is written EXACTLY ONCE, already
  closed, only after `runBatch()` returns and the aggregate is computed.
  `EvalBatchWrite` (the port's insert type) now carries both the pin fields
  (`agentVersion`/`provider`/`model`/`skillsFingerprint`) AND the final
  aggregate AND an explicit `ranAt: Date` — `runPinnedBatch` still captures
  `ranAt = new Date()` at the old "OPEN" moment (before running any case) so
  the persisted `ran_at` keeps meaning "when the batch started," even though
  the actual DB write now happens after the batch finishes. Per-case
  `eval_runs` inserts had to move to AFTER the batch insert (their `batch_id`
  column is a real FK against `eval_batches.id` — you cannot insert a run row
  referencing a batch that doesn't exist yet), which is safe here because
  `runBatch()` already collects every case's result fully in memory before
  any per-case persistence happens. Net effect: a still-running batch now
  has literally NO row in `eval_batches` until it's done — nothing for any
  read path to pick up as "latest" — and a mid-batch crash leaves no row at
  all rather than a permanent bogus one. **Alternative considered and
  rejected:** adding a `'running'` status value (would require widening
  `EvalBatchRecord.status`/`eval_batches.status` in both vendored
  `eval-ci.ts` copies) — rejected as the larger diff for no real benefit,
  since a `'running'` row would STILL need active exclusion from every read
  path (same problem, just moved into a filter instead of removed by
  construction) and would STILL get stuck forever on a process crash. If a
  future session is tempted to add an "open" batch row again (e.g. to show
  live progress mid-run), it needs an explicit exclusion filter on every one
  of `listBatchesForOwner`/dashboard/trend/compare — don't reintroduce the
  old shape without also adding that filter everywhere this entry's "why it
  matters" paragraph describes.
  **Amended 2026-08-21 (Phase C fix-loop iteration 2, Minor findings #1/#2)
  — the single `insertClosedBatch` + N separate `insertRun` calls above were
  themselves N+1 separate autocommits with no transaction, so a throw/crash
  between them could still commit a batch whose `cases_total` didn't match
  its actual `eval_runs` row count.** Merged into one
  `EvalRepository.insertBatchWithRuns(batch, runs)` port method that wraps
  the batch insert and every run insert in a single `db.transaction` (this
  repo's first use of `.transaction(...)` anywhere in `server/src` — `grep
  -rn "\.transaction("` returned zero hits before this change). Fixes Minor
  finding #1 by construction: if anything in the transaction throws, nothing
  commits, so a persisted batch's `cases_total` and its `eval_runs` row count
  can never diverge. **Honest residual (Minor finding #2), not fully fixed:**
  this only protects what the transaction commits — if the process crashes
  WHILE `runBatch()` is still executing (i.e. before this transaction even
  starts), any spend already incurred by cases that already completed is not
  persisted anywhere and is not recoverable. Fixing that fully would mean
  committing each case's cost as it finishes, which is the pre-fix-loop-1
  per-case-write design this whole entry describes moving away from — so
  it's accepted as a tradeoff, documented here and in `EvalBatchWrite`'s doc
  comment (`repository.ts`), not silently claimed as a pure win.
- **Testcontainers-backed `*.it.test.ts` files (`test/helpers/pg.ts`'s
  `startPg()`) are fully self-contained** — they spin up their OWN ephemeral
  `pgvector/pgvector:pg16` container and run migrations, independent of the
  docker-compose `devdigest-postgres` container `pnpm dev` normally talks to.
  Confirmed 2026-08-21: both the manually-started `devdigest-postgres`
  container and a `startPg()`-spun one ran side by side in the same session
  with no conflict (different ports, testcontainers picks an ephemeral one).
  **This contradicts this file's own "Docker Desktop is not auto-started in
  this environment" framing (see root `INSIGHTS.md`'s Tool & Library Notes)
  — that note describes one session's environment state, not a permanent
  fact about this dev machine.** Always check `docker info` (or
  `dockerAvailable()`) fresh each session rather than assuming Docker is
  down because a past session's notes said so; if it's up, running the real
  `.it.test.ts` suite (or a throwaway ad hoc one against `startPg()`) is a
  strictly stronger correctness check than unit tests alone for anything
  touching `repository.drizzle.ts`.

## Recurring Errors & Fixes

- **`test/indexer-pipeline.test.ts` fails 6/11 tests with `ENOENT: no such
  file or directory, open '...\repo-intel-{full,inc}-<rand>\src\...'`
  on this Windows environment, unrelated to whatever you're actually
  changing.** Confirmed 2026-08-07 (Intent Layer design fix-ups session,
  `docs/plans/intent-layer.md` WI10–13): the file/module wasn't touched at
  all this session (`git status --porcelain` clean on it) yet
  `pnpm exec vitest run --exclude '**/*.it.test.ts'` still fails those 6
  tests every run — the test's own `writeFileAt` helper (line ~144) can't
  find the directory it just `mkdir(..., {recursive:true})`'d inside a
  freshly `mkdtemp`'d Windows temp dir, a timing/path quirk of this shell
  environment, not a real regression. Before treating a failure here as
  something you broke, check `git status` on the file first — if it's
  untouched, it's this pre-existing flake, and the rest of the suite (108+
  tests) is the real signal.
- **`server/src/modules/orders/orders.ts` fails `pnpm typecheck`
  independent of any Intent Layer work** — `db` import (should be `Db`) and
  two untyped handler params. Pre-existing as of commit `71fe1ed` ("Move
  fixture endpoint to server/src/modules/orders"), confirmed via
  `git log -1 -- <path>` + `git diff --stat` both showing no session
  changes to it. `cd server && pnpm typecheck` will always show these 3
  errors until that file is fixed separately — don't assume your own
  change broke typecheck without first checking whether the errors are in
  a file you actually touched.
  **STALE as of 2026-08-08/09 — fixed outside this note's originating plan.**
  `orders.ts` is a deliberately-fake `payments-api-fixture` package
  (simulating the seeded `acme/payments-api`, imported by nothing real) that
  `server/tsconfig.json`'s `include: ["src/**/*.ts"]` was sweeping into
  typecheck; a `"exclude": ["src/modules/orders/**"]` entry was added.
  Confirmed 2026-08-09 (L04 Blast Radius session): `cd server && pnpm
  typecheck` is clean with zero errors. Any typecheck error you see now is
  real and belongs to whatever you touched — don't reflexively attribute it
  to this old, now-resolved entry.
- **`curl -d '{"...":"... — ..."}'` (em dash, U+2014, or other multi-byte
  UTF-8 chars) from Git Bash on Windows can fail with `{"error":{"code":
  "internal_error","message":"Request body size did not match
  Content-Length"}}`** — observed testing `PUT /skills/:id` manually. Not a
  server bug: Git Bash's `curl` under MSYS appears to miscompute
  `Content-Length` for some multi-byte characters passed via `-d`/heredoc.
  Fix: avoid non-ASCII punctuation (em dash, curly quotes) in ad hoc
  `curl -d` test payloads on this platform, or use `--data-binary @file`
  with a UTF-8 file instead of inline `-d`.
- **The seeded demo repo `acme/payments-api` has `clone_path: null`** — it
  was never git-cloned locally (it's a synthetic fixture, not a real
  GitHub repo), so `loadDiff()` always returns an empty diff for its one
  seeded PR (#482) regardless of branch-fetch state. This is a different
  root cause from the "local clone only fetches `main`" issue documented
  below — there `git fetch origin <branch>` fixes it; here there is no
  clone to fetch into at all, so a real diff for this PR is not obtainable
  locally. Don't spend time debugging this one as if it were the
  fetch-refspec issue — pick a real, cloned repo/PR instead for any
  diff-dependent verification.
- **A review run that completes instantly with `findings_count: 0` and a
  summary literally saying "The diff is empty — no code changes were
  introduced"/"no files were changed", even though the PR clearly has a
  non-empty diff, means the reviewer's local git diff failed silently, not
  that the PR is actually empty.** `loadDiff()`
  (`src/modules/reviews/diff-loader.ts`) runs `git diff base...head`
  against the **local clone** at `server/clones/<owner>/<repo>`
  (`src/adapters/git/simple-git.ts:94-95`), and that clone's
  `remote.origin.fetch` refspec is hardcoded to
  `+refs/heads/main:refs/remotes/origin/main` (set wherever the clone is
  first created) — it **only ever fetches `main`**, never other branches.
  So for any PR whose head commit isn't reachable from `main` in that local
  clone (e.g. a brand-new PR branch just pushed/opened, or a fork branch
  the clone never fetched), `git diff` throws/returns nothing, and
  `loadDiff()`'s fallback to `diffFromPrFiles()` (reconstructing from
  persisted `pr_files` patches) *also* comes up empty — because
  `POST /repos/:id/poll` (`src/modules/polling/routes.ts`), the endpoint
  that syncs new PRs from GitHub, only upserts PR metadata into
  `pull_requests`; it never persists file patches into whatever table
  `ReviewRepository.getPrFiles()` reads. Net effect: **both the primary
  diff source and its fallback are empty for any PR synced via `/poll`
  whose branch was never locally fetched**, and the reviewer silently
  "reviews" nothing while reporting success. Fix: `cd` into the repo's
  clone dir and manually fetch the specific branch/SHA (e.g.
  `git fetch origin <branch>`) before (re-)triggering the review —
  `POST /repos/:id/refresh` does NOT help here, it re-fetches only `main`
  too. Confirmed via `git cat-file -t <sha>` in the clone dir before/after.
  Delete the empty-diff run(s) (`DELETE /runs/:id`) and re-trigger
  (`POST /pulls/:id/review`) once the SHA is fetchable.

- **`pnpm db:migrate` / `pnpm db:seed` silently do nothing on Windows,
  leaving an empty DB** (symptom: app errors like `relation "users" does
  not exist` or "No default workspace found" even right after running
  them, with zero console output and exit code 0). Root cause: both
  `src/db/migrate.ts` and `src/db/seed.ts` gated their CLI entrypoint on
  `import.meta.url === \`file://${process.argv[1]}\``. On Windows
  `import.meta.url` is `file:///C:/...` (forward slashes) while
  `process.argv[1]` is a native path (`C:\...`), so the concatenated
  string never matches and the whole entrypoint block is skipped — the
  script exits 0 having done nothing. Fixed by comparing
  `fileURLToPath(import.meta.url) === process.argv[1]` instead (both
  sides then in native OS path form). If a similar `tsx`/ESM CLI script
  is added later, use the same comparison, not the raw URL-string one.

- **`pnpm db:generate` prompts interactively ("Is X column created or
  renamed from Y?") whenever one `drizzle-kit generate` run both drops a
  column and adds new ones on the same table** — and that TUI prompt does
  not work over this environment's non-interactive shell (hangs/exits
  oddly, piping newlines via `printf '\n' | pnpm db:generate` does not
  answer it). Workaround: split into two separate `db:generate` runs —
  first add the new columns while temporarily keeping the old one (pure
  ADD, no ambiguity, no prompt), run `db:generate`, then remove the old
  column and run `db:generate` again (pure DROP, no prompt since there's
  no candidate new-column to match it against). Produces two small
  migration files instead of one; that's fine, don't try to force a single
  migration file by fighting the prompt. Used for the `conventions` table's
  `accepted` boolean → `category`/`status`/`skill_id` migration, 2026-08-02.

- **`pnpm db:generate` writes three artifacts, not one — commit all three
  together or the migration silently doesn't exist on a fresh checkout
  (2026-08-14).** It writes the migration SQL file
  (`src/db/migrations/NNNN_*.sql`), updates
  `src/db/migrations/meta/_journal.json` to register it, and writes a new
  `src/db/migrations/meta/NNNN_snapshot.json`. `drizzle`'s `migrate()`
  (`src/db/migrate.ts`) reads `_journal.json` to know which migrations to
  run — if only the `.sql` file gets `git add`ed/committed and the journal/
  snapshot changes are left uncommitted (easy to miss: they're two levels
  deep in `meta/` and don't look like "the migration" at a glance), a
  fresh `pnpm db:migrate` on another checkout silently skips that
  migration entirely, with no error. Caught by `plan-verifier`'s Phase 1
  for the Onboarding Generator's 0017 migration — the columns existed on
  the session's own disk (already migrated there) but the committed tree
  couldn't produce them. Always `git status` the whole
  `src/db/migrations/` tree (not just the `.sql` file you expect) after
  `pnpm db:generate`, and stage the journal + every new/changed snapshot
  alongside the migration in the same commit.

- **`pnpm db:generate` cannot auto-resolve an unnamed single-column PRIMARY
  KEY's constraint name when the schema change replaces it with a composite
  key (2026-08-14, SPEC-03 WI2, `pr_brief`'s `pr_id`-only PK → `(pr_id,
  head_sha)`).** The generated `.sql` contains a commented-out `-- ALTER
  TABLE "x" DROP CONSTRAINT "<constraint_name>";` placeholder plus its own
  header comment admitting it can't fill in the name yet, and — worse — puts
  the `ADD CONSTRAINT ... PRIMARY KEY(...)` statement BEFORE the `ADD COLUMN`
  statement for the new key column the constraint depends on. Running it
  as-generated fails twice over: Postgres allows only one PRIMARY KEY per
  table (the old one is still there), and the new column referenced by the
  composite key doesn't exist yet at that point in the script. Fix: query the
  live DB for the real name — `SELECT constraint_name FROM
  information_schema.table_constraints WHERE table_schema='public' AND
  table_name='<table>' AND constraint_type='PRIMARY KEY'` (came back
  `pr_brief_pkey`, Postgres's own default-naming convention for an unnamed
  single-column PK) — then hand-reorder the generated SQL: `ADD COLUMN`s
  first, then `DROP CONSTRAINT "<real_name>"`, then `ADD CONSTRAINT ...
  PRIMARY KEY(...)`. This is a sanctioned COMPLETION of what drizzle-kit
  itself flagged as a manual TODO in its own comment, not a violation of
  "never hand-edit migrations" — the file is still the one `db:generate`
  produced, just finished. Confirmed correct by dropping/reapplying against
  live Docker Postgres (`src/db/migrations/0018_real_iceman.sql`). Any future
  primary-key-shape change (not just a column rename/drop, per the two
  interactive-prompt entries above) should expect this same gap.

- **`arch:check`'s `no-helpers-to-io` rule is STRICTER than
  `no-service-to-db` about `src/db/rows.ts` (2026-08-14, SPEC-03
  `modules/brief/helpers.ts`).** `no-service-to-db`'s `to.path` regex
  (`.dependency-cruiser.cjs`) explicitly carves out `db/rows.ts` — a
  `service.ts` may import a plain Drizzle-inferred row type from there (it's
  treated like a DTO at the port boundary, per the rule's own comment).
  `no-helpers-to-io`'s `to.path` has NO such carve-out — it blocks ALL of
  `^src/db/`, full stop. A new module's `helpers.ts` needing a DB row's shape
  to type a pure function (e.g. `mapRowToRecord(row: XRow): Y | null`) must
  NOT `import type { XRow } from '../../db/rows.js'`, even though the import
  is type-only and the row itself is plain data — `pnpm arch:check` fails
  with one `no-helpers-to-io` violation, immediately, one-line cause. Fix:
  define a LOCAL, structurally-identical interface in `helpers.ts` instead of
  importing the real one — TypeScript's structural typing means the actual
  Drizzle-inferred row is still assignable to it with zero cast needed. See
  `server/src/modules/brief/helpers.ts`'s `BriefRow` (local mirror) vs.
  `server/src/db/rows.ts`'s `PrBriefRow` (the real type, used freely by
  `repository.ts`/`repository.drizzle.ts`/`service.ts`, none of which match
  the helpers-only rule).

## Session Notes

- 2026-08-01: Added `.claude/skills/onion-architecture` skill (forces
  routes→service→port←adapter on NEW `modules/*` code only — existing
  modules are deliberately not retrofitted) plus a working
  `server/.dependency-cruiser.cjs` + `pnpm arch:check` enforcing it. Verified
  the check both passes clean on current code and actually catches a
  violation (tested by temporarily adding a `service.ts` that imported
  `db/client.ts` directly, confirmed it failed the check, then removed the
  test file). See Tool & Library Notes above for the ESLint-vs-
  dependency-cruiser reasoning and the `to.path` node_modules-prefix detail.
- 2026-07-29: Re-added per-run cost end-to-end (Run Cost Badge feature):
  `agent_runs.cost_usd` column + migration `0010`, threaded `costUsd`
  through `run-executor.ts`/`repository.ts`/`run.repo.ts`, added
  `cost_usd` to `RunStats`/`RunSummary`/`PrMeta` contracts (both vendor
  copies), and extended the pulls-list route to resolve cost via the same
  `reviews.runId` link already used for `score`.
- 2026-07-30: Findings counter (L01) — wired up the previously-dead
  `rollupSeverities`/`SeverityCounts` (no migration; see What Works above),
  added `critical_count`/`warning_count`/`suggestion_count` to `PrMeta` and
  `RunSummary` (both vendor copies), removed the dead client `PrRowView`
  type it was blocking, and extended `reviews.it.test.ts` to assert both
  endpoints return the grounded severity breakdown.
- 2026-07-31: Verified the client-side findings-counter interactivity work
  (hover popover, clickable badges, in-diff markers) against a real PR —
  pushed `demo/findings-ui-verification` (PR #2) to `AneliiaOleksiuk/dev-
  digest` with planted CRITICAL/WARNING/SUGGESTION issues under
  `qa/review-bait/`, synced via `/poll`, hit the local-clone-fetch gap
  above, worked around it, then got real mixed-severity findings from all
  3 configured agents. See Recurring Errors & Fixes for the root cause —
  worth fixing properly (e.g. `/poll` or `/review` fetching the specific
  PR branch before diffing) so this doesn't surprise the next person who
  reviews a freshly-opened PR.

- 2026-08-02: Skills feature server side — new `modules/skills/` (onion-
  architecture port/adapter split: `repository.ts`/`repository.drizzle.ts`,
  `SkillsService` taking the repo interface directly rather than
  `Container`), `/skills` CRUD + `/skills/:id/versions` (body-only
  versioning — name/description/type edits don't bump version, only
  `body` changes do, since body is the actual prompt content), and
  `/skills/import/file` + `/skills/import/url` (new `SkillUrlFetcher`
  port/adapter, minimal SSRF guard: https-only, 8s timeout, 200KB
  streamed cap — no private-IP/DNS blocking yet). Wired
  `run-executor.ts` to pull an agent's enabled+ordered linked skills
  (`this.agents.linkedSkills()`, already existed) into
  `reviewPullRequest({skills})` — `reviewer-core` already supported this
  end to end (`ReviewInput.skills` → `assemblePrompt` → trace
  `prompt_assembly.skills`), so this was pure plumbing, no reviewer-core
  changes. Verified live against a real run (see `Recurring Errors &
  Fixes` for why PR #482's diff itself is empty): trace's
  `prompt_assembly.skills` went `null` → all 4 linked skill bodies when
  linked, tokens_in 446 → 1117; disabling one linked skill (`enabled:
  false`) correctly dropped only that skill's body from the next run's
  trace while the other three stayed. Community-catalog search/import
  (`GET /skills/community`) intentionally left unbuilt — no catalog data
  source exists yet, deferred as a separate pass per the spec.
- 2026-08-02: Conventions Extractor (L02 homework, spec at
  `specs/conventions-extractor.md`) — extended `conventions` table
  (`category`/`status` enum/`skill_id`, dropped `accepted`; see Recurring
  Errors & Fixes for the 2-pass migration workaround), new
  `modules/conventions/` (onion port/adapter, same shape as `modules/
  skills/`): `POST /repos/:id/conventions/extract` (samples config files +
  `repoIntel.getConventionSamples`, calls `completeStructured` via
  `resolveFeatureModel(..., 'conventions')` — the first real caller of that
  previously-unwired registry, see `modules/settings/feature-models.ts`),
  code-grounds every LLM candidate against the actual sampled file content
  before persisting (ungrounded candidates silently dropped, never reach
  the DB), `PATCH /conventions/:id` (accept/reject/edit), `POST /
  conventions/promote` (bundles accepted candidates into one real skill via
  the existing `SkillsService.create`). Also built a second, independent
  piece: an `API Contract Reviewer` agent + 4 skills (3 manual, 1 via
  `/skills/import/file`) and ran the skills-off/skills-on control
  experiment against a hand-seeded synthetic PR (see What Works above for
  the `diffFromPrFiles` technique) — see What Doesn't Work above for the
  experiment's actual (more nuanced than expected) result. Hit and fixed
  the NUL-byte insert crash and the OpenAI/Anthropic billing exhaustion
  live during this session — both documented in Tool & Library Notes
  above.

- 2026-08-07: Intent Layer (plan `docs/plans/intent-layer.md`) — server
  side: `pr_intent` ADD-only columns, `intent-inputs`/`IntentService`,
  run-executor best-effort classify, GET/POST `/pulls/:id/intent`,
  tokenizer comment widened for reviews use (see Tool & Library Notes),
  recorded pre-existing `trace.ts` vendor comment drift (see Codebase
  Patterns). No further product edits in this follow-up — plan-verifier
  required INSIGHTS notes only.
- 2026-08-07: Architecture-reviewer follow-up — `specs_read` only on fresh
  classify (`getOrClassify` returns `{ reused }`; `specPathsFrom`);
  classifier spec header no longer embeds path in trusted position;
  `specs_read` contract docblock widened in both vendor `trace.ts` copies.
- 2026-08-07: Intent Layer design fix-ups (plan `docs/plans/intent-layer.md`
  WI10–13, mock-parity pass after the functional WI1-9 build) — server side
  (WI10 only): `risk_areas: z.array(z.string()).default([])` added to
  `Intent` (both vendor `brief.ts` copies), `IntentClassifierOutput` +
  `CLASSIFIER_SYSTEM_PROMPT` extended so the model authors short (≤5, ≤~12
  words) risk bullets, ADD-only migration `0015_jazzy_dark_phoenix.sql`
  (`risk_areas jsonb not null default '[]'`), `pull.repo.ts` persists/reads
  it (NUL-scrubbed like every other LLM string field), `renderIntentBlock`
  folds it into the reviewer-facing text block. `missing_context` prompt
  instructions tightened to one short sentence per item. Verified live via
  `reviews.it.test.ts`'s real-Postgres intent route test. Client-side design
  work (WI11 IntentCard hierarchy, WI13 3-panel Overview) is `client/
  INSIGHTS.md`'s entry for the same date.
- 2026-08-07: Smart Diff (`modules/smart-diff/`) — new onion module (not a
  fat `pulls/routes.ts` handler) with path-based `classifyPath` (boilerplate
  → wiring → core), `GET /pulls/:id/smart-diff`, and
  `container.smartDiffRepo`. Findings come from the single latest `reviews`
  row only (same semantics as PR-list score). No LLM, no migration,
  `pseudocode_summary` always null. `package.json` + tests are boilerplate
  (mock parity); bootstrap basenames (`index.ts`, `server.ts`, …) are wiring.

- 2026-08-09: Blast Radius server side (Part 1 of
  `docs/plans/l04-blast-radius-and-prepush-cli.md`) — WI1's required
  per-symbol caller-cap bug fix in `repo-intel/service.ts` (see Codebase
  Patterns above), new `modules/blast/` module (`GET /pulls/:id/blast`),
  `container.blastRepo`, `BlastRadiusResponse` contract added to
  `contracts/review-api.ts` and hand-mirrored to `client/`, and the
  endpoint-detection depth documented in `modules/repo-intel/README.md`
  (WI4 — verification + prose only, no new traversal code). Client
  (`BlastTab`, `BlastRadiusCard` real data) and the MCP `get_blast_radius`
  tool are the same session's client/mcp INSIGHTS entries. Part 2 (the
  pre-push CLI) was a separate, concurrent agent's work in the same
  session — not covered by this entry.
- 2026-08-09 (later, L04 follow-ups plan `docs/plans/l04-followups-blast-inline-and-fixes.md`
  Part A): `BlastRepository.getPriorPrsForFiles` added (see Codebase
  Patterns above for the full shape) and wired through `BlastService`'s
  existing `Promise.all`; `summary` deliberately left untouched (prior PRs
  are provenance, not blast radius). `pnpm arch:check` stayed clean (no new
  port/adapter boundary violation). This landed alongside three unrelated,
  file-disjoint client-side items (intent-hook rename, a Smart-Diff
  severity-badge fix, a new `verify-l03.sh` gate) executed by three parallel
  implementer agents in the same shared working tree — see `client/
  INSIGHTS.md` and root `INSIGHTS.md` for those.
- 2026-08-09 (demo): PR-tip checkout + full index for blast fixture; added
  `getNameMatchedCallers` fallback when `decl_file` stays NULL (empty
  `file_edges`). Live `rateLimit` callers+endpoints on PR #3. Do **not**
  click list Refresh — resync restores `main` and drops the PR fixture.

- 2026-08-13: Project Context (SPEC-01, plan `docs/plans/spec-01-project-context.md`)
  server side — new `modules/project-context/` (onion port/adapter:
  `discover.ts` bounded recursive `.md` walk modelled on `repo-intel/pipeline/
  walk.ts`, `repository.ts`/`repository.drizzle.ts`, `service.ts`, `routes.ts`),
  new `project_context_attachments` table (migration `0016`, polymorphic
  `surface`/`surface_id` with NO FK — compensated by `AgentsService.delete`/
  `SkillsService.delete` explicitly calling `contextRepo.deleteForSurface`),
  `AppConfig.projectContextRoots` (env `PROJECT_CONTEXT_ROOTS`, default
  `specs,docs,insights`), and the `run-executor.ts` wiring that finally
  populates `PromptParts.specs` (`reviewer-core` untouched — confirmed via
  `git diff --stat reviewer-core/` returning empty both before and after).
  Two ripples the plan's WI7 file list didn't anticipate, needed purely to
  keep the codebase compiling once `RunTrace.project_context_docs` was added
  as a real (if `.default([])`) field: **any hand-built `RunTrace` object
  literal needs the field even though `.default()` covers `.parse()` calls**
  — `platform/trace-builder.ts`'s `buildRunTrace` (shared by other run paths:
  built-in detectors, multi-agent runs) needed a new optional
  `projectContextDocs` input defaulting to `[]`, and the client's
  `RunTraceDrawer.test.tsx` fixture needed the field added too. Same pattern
  server/INSIGHTS.md already documented for `PrIntentRecord`/`risk_areas` —
  grep every hand-typed object literal against an extended `z.infer` schema,
  not just the schema's own `.parse()` call sites, whenever a contract gains
  a new non-optional-with-default field.
  Two deviations from the plan's literal port-method signatures, both
  necessary for correctness rather than convenience: `ContextRepository
  .listFor`/`listForAgentEffective` needed a required `repoId` param (the
  plan's stated signature omitted it) — a skill/agent can hold attachments
  against several repos at once (E-8), so an unscoped read can't be
  correctly rendered on a single-repo Context tab; and `ContextDocument`
  gained a `used_by_agents: number` field beyond WI1's literal shape list,
  because AC-8 requires it on the listing response and WI5 explicitly
  computes it via `usageCountsByPath` — the shape list appears to have been
  an oversight in the plan, not a deliberate omission.
  Verified: `pnpm typecheck` clean, `pnpm arch:check` clean (new module
  respects the onion boundary), full unit suite green except the
  pre-existing `indexer-pipeline.test.ts` Windows flake (untouched file,
  confirmed via `git status`), and a new `.it.test.ts` (real Postgres) round-
  tripping AC-1/AC-3/AC-9/AC-10/AC-16/cross-workspace-404 end to end through
  real HTTP routes. WI13 (live grounding verification on PR #3) intentionally
  NOT attempted this session — it requires pushing a commit to a real, shared
  GitHub PR branch, which needs explicit human approval of the exact diff
  before the push per the plan's approval gate; that approval could not be
  obtained within this session, so WI13 is reported blocked, not done.

- 2026-08-13: SPEC-01 fix pass after test-writer — E-5 binary skip in
  `resolveEffectiveSet` now uses `readUtf8OrNull` (`isUtf8` on a Buffer)
  instead of `readFile(..., 'utf8').catch()`, which never threw. See Tool
  & Library Notes above.

- 2026-08-13: SPEC-01 plan-verifier fix-loop iteration 1 — reconciled
  vendored `trace.ts` comments (server `T1.3`/`T3` copied onto client);
  AC-15 defense-in-depth skip in `resolveEffectiveSet`; `listMismatchedForAgent`
  + run-log line `project context: skipped (other repo) — ${path}`;
  `other_repo_documents` on `ContextAttachmentSet` (no 7th endpoint);
  `listDocuments` throws `NotFoundError` for a missing repo (route no
  longer calls `contextRepo.getRepo`). See Codebase Patterns above.

- 2026-08-13: SPEC-01 amendment (AC-29–AC-53, plan
  `docs/plans/spec-01-project-context-authoring.md`) server side, WI1–WI5 —
  `ContextDocumentContent`/`SaveContextDocumentBody`/
  `CreateContextDocumentBody`/`ContextWriteResult` contracts +
  `ContextListing.roots` added to both `platform.ts` vendor mirrors (Rec-4);
  `MAX_DOC_PATH_DEPTH`/`MAX_DOC_PATH_LENGTH`/`MAX_DIRTY_PATHS_SHOWN` added to
  `project-context/constants.ts` (values approved by the user, not
  re-derived); new pure `write-guards.ts` (see Codebase Patterns above);
  `service.ts` gained `saveDocument`/`createDocument` plus a `revision` on
  `getDocumentContent`, both write paths sharing the guard chain (Rec-6);
  `ConflictError` (409) added to `platform/errors.ts` (Rec-2); `PUT`/`POST
  /repos/:id/context/document` routes added; `GitClient.sync` gained the
  AC-50 dirty-clone precondition (`adapters/git/simple-git.ts`, new
  `adapters/git/errors.ts` `DirtyCloneError`, `MockGitClient.dirtyPaths`),
  and `RepoIntelService.resyncRepo` catches it before the generic
  `sync_failed:` branch and persists `dirty_clone:<paths>` through
  `touchIndexState` (Rec-5/R-4 accepted gap: no-op on a never-indexed repo).
  Both vendored `adapters.ts` `GitClient.sync` docblocks updated — see
  Codebase Patterns above for the client-copy drift this surfaced.
  Verified: `pnpm typecheck` clean (server: one pre-existing unrelated error
  in `adapters/auth/local.ts:40`, not touched this session — present before
  this session started per initial `git status`); `pnpm arch:check` clean;
  full unit suite green except the pre-existing `indexer-pipeline.test.ts`
  Windows flake (confirmed via `git status` — file untouched, matches the
  existing Recurring-Errors-&-Fixes entry); all 8 integration test files (41
  tests) green against live Docker Postgres, including the pre-existing
  `project-context.it.test.ts`/`project-context-run.it.test.ts`. Client-side
  WI6–WI10 done in the same session — see `client/INSIGHTS.md`. Test
  authorship for the new write paths (AC-34–AC-53) is explicitly `test-
  writer`'s job next, not done here beyond the pre-existing suites passing.

- 2026-08-14: SPEC-02 Onboarding Generator (plan
  `docs/plans/spec-02-onboarding-generator.md`) server side, WI1-WI9 — new
  `modules/onboarding/` (`facts.ts` for file I/O, pure `helpers.ts`,
  `prompt.ts`, `service.ts`, `repository.ts`/`repository.drizzle.ts`,
  `routes.ts`), generation-metadata columns added to `onboarding`
  (migration `0017_sweet_rachel_grey.sql`, a clean single-pass `ADD COLUMN`
  set — no interactive drizzle-kit prompt this time since nothing was
  dropped/renamed, contrast the DROP+ADD workaround documented above),
  `container.onboardingRepo`, and the previously-unloaded
  `prompts/onboarding.system.md` finally wired via `renderPrompt`. `pnpm
  arch:check` stays clean with the new module **not** added to
  `PRE_EXISTING_MODULES` — confirmed the `conventions/service.ts` precedent
  (importing `RepoRepository` from `modules/repos/repository.js` directly in
  a non-exempt module's `service.ts`) is legitimate: dependency-cruiser's
  `no-service-to-db` rule only matches DIRECT edges from `service.ts` to
  `db/(schema|client)`, not transitive ones through another module's own
  repository, so this pattern is arch-check-safe as long as the import
  target isn't itself under `src/adapters/` or `src/db/`.
- 2026-08-14: The onboarding table's generation-metadata columns
  (`status`/`provider`/`model`/`tokensIn`/`tokensOut`/`costUsd`/`callCount`/
  `indexSha`/`filesIndexed`/`indexStatus`) were modeled on `agentRuns`
  (`db/schema/runs.ts`) field-for-field, INCLUDING its `doublePrecision`
  (not `numeric`) for `costUsd` — simpler than `numeric`'s `{mode:'number'}`
  config for the exact same `number | null` round-trip, and matches the
  ALREADY-established codebase convention (`agent_runs`/`eval_runs`/
  `ci_checks` all use `doublePrecision('cost_usd')`), not the plan's
  literal-but-untested "numeric" suggestion. Metadata lives in dedicated
  columns, never inside `onboarding.json`, specifically because the `json`
  column must parse cleanly against the `Onboarding` zod contract
  (`{sections}` only) on every read — a zod object silently strips unknown
  keys, so metadata smuggled into `json` would be destroyed by that same
  validation.
- 2026-08-14: **`knowledge.ts` (both vendor copies) has pre-existing drift
  UNRELATED to onboarding** — discovered while adding the new
  `OnboardingStatus`/`OnboardingGenerationUsage`/`OnboardingTourResponse`
  contracts, which had to be placed AFTER the `Provider` enum (referencing a
  `const` before its declaration throws at module load, temporal dead
  zone) rather than physically next to the existing `Onboarding`/
  `OnboardingSection` block the plan pointed at. The client copy is missing
  `AgentVersionConfig`/`AgentVersion` entirely and has shorter comments on
  `Provider`/`CiFailOn` than the server copy — same "leave pre-existing
  drift alone unless deliberately reconciling the whole file" rule this file
  already documents for `trace.ts`. New content was appended at the very END
  of both files (after each file's own existing tail) specifically so it
  introduces ZERO new diff on top of that pre-existing drift — confirmed via
  `git diff --no-index` before/after: the hunks are identical, nothing new.
  Don't "fix" the older drift as a drive-by from a future onboarding session.
- 2026-08-14: The `run_locally` section's model-authored markdown has NO
  structured `commands[]` field — the shared `OnboardingSection` contract is
  flat (`{kind,title,body,diagram,links}`), so AC-8's "every shell command
  must be verbatim-matched or dropped" is enforced by regex-extracting
  fenced-code-block (```) LINES from the markdown `body` and substring-
  matching each trimmed line against the concatenated run-locally source
  files — a whole fence collapses to nothing (removed entirely, not left as
  an empty ` ``` ` pair) if every one of its lines fails to match. Inline
  code spans (single backticks) are deliberately NOT put through this check
  — treated as identifiers/short mentions, not full shell commands; only
  fenced blocks are. If a future session needs finer-grained command
  extraction, this is the seam (`groundRunLocallyBody`/`extractDeterministic
  Commands` in `modules/onboarding/helpers.ts`), not a reason to add a
  `commands[]` field to the shared contract without a product decision.
- 2026-08-14: AC-12's "First tasks" complexity/difficulty badge could NOT be
  built per-task-card as the reference design implies, because
  `OnboardingSection` has no structured per-task array to attach a badge
  to — only one flat markdown `body`. Implemented as ONE section-level badge
  ("Model estimate", with a tooltip) on the `first_tasks` card instead of a
  per-card badge — a deliberate, documented simplification given the
  contract shape, not an oversight. If a later iteration wants true
  per-task badges (Recommendation 4's rank-percentile alternative), that
  needs a contract change (a structured `tasks[]` field) which is out of
  this iteration's scope.

- 2026-08-14: SPEC-03 PR Brief & Why Timeline (plan
  `docs/plans/spec-03-pr-brief-and-why-timeline.md`) server side, WI1-WI8 —
  `Brief`/`ReviewFocusItem`/`BriefInputStatus`/`BriefUsage`/`BriefRecord`/
  `BriefState`/`BriefResponse`/`BriefTimelineEntry`/`BriefTimelineResponse`
  added to both vendored contract copies (`brief.ts`/`review-api.ts`, D-1);
  `pr_brief` table repurposed from one-row-per-PR to one-row-per-(PR,
  head_sha) (migration `0018_real_iceman.sql`, composite PK — see Recurring
  Errors & Fixes for the hand-completed DROP/ADD CONSTRAINT step); new
  `modules/brief/` (onion: `constants.ts`, `repository.ts`/
  `repository.drizzle.ts`, `sources.ts`/`sources.node.ts` for the non-DB
  input port, `prompt.ts`/`budget.ts`/`grounding.ts` all pure, `helpers.ts`,
  `service.ts`, `routes.ts`), `container.briefRepo`/`container.briefSources`.
  `grounding.ts` mirrors `reviewer-core/src/grounding.ts`'s `buildLineIndex`
  rule locally rather than importing it (E-9 — not re-exported by the package
  barrel, and Brief's items aren't `Finding`s). `budget.ts`'s spec-file
  sub-cap (2 500 tokens, whole-document admission only) and its four-stage
  AC-24 trim order (spec excerpts → linked issue → collapsed hunk headers →
  binary-searched file-list truncation) are unit-testable independent of any
  I/O, per the plan's own `count: (s: string) => number` DI-tokenizer
  parameter. `sources.node.ts` re-resolves the full `PullRow`/`repos` row via
  a fresh `ReviewRepository(container.db)` inside `loadDiff` rather than
  widening `BriefPull`/`BriefRepoRow` to match `diff-loader.ts`'s literal
  `PullRow` param type — a deliberate small redundant read (cheap relative to
  the LLM call the generation is about to make) that keeps the module's own
  port types narrow. Verified: `pnpm typecheck` clean, `pnpm arch:check`
  clean (see Recurring Errors & Fixes for the `no-helpers-to-io` gotcha this
  surfaced), full unit suite green except the pre-existing
  `indexer-pipeline.test.ts` Windows flake (confirmed via `git status` —
  untouched file), and the full `.it.test.ts` suite green except the
  pre-existing 8-test `onboarding.it.test.ts` fixture gap (confirmed
  pre-existing and unrelated via `git status` — matches the exact 8 tests
  server/INSIGHTS.md's FIX-8 entry already documents). Client-side WI9-WI14
  is `client/INSIGHTS.md`'s entry for the same date. Test authorship
  (`test-writer`'s job next) not attempted beyond the pre-existing suites
  passing.

- 2026-08-23: SPEC-04 Multi-Agent Review `plan-verifier` fix-loop iteration 1
  — server-side + shared-contract findings only (a parallel client fix-loop
  agent handled `client/src/app/repos/[repoId]/multi-agent/**`, a separate
  test-writer runs after both land). Five fixes: (1) `AgentColumn.error`
  added to both vendor `observability.ts` copies (as `.nullish()`, not
  `.nullable()` — see Codebase Patterns for why), and `multi-agent-read.ts`
  no longer overloads `summary` with error text; (2) `deriveConflicts`
  (`multi-agent-derive.ts`) no longer pre-filters to AC-30 "genuine
  conflicts" only — emits every shared location, unfiltered, so the client's
  AC-31 "show all" toggle state has data to render; (3) `EvalOwnerKind`
  widened to include `'finding'` in both vendor `knowledge.ts` copies
  (diff-of-diffs verification method, see Codebase Patterns); (4) DB-level
  uniqueness for two TOCTOU-racy idempotency checks — `eval_cases` gained a
  uniqueIndex on `(workspace_id, owner_kind, owner_id)`, `memory` gained a
  new `learned_finding_id` uuid column + uniqueIndex, migration
  `0020_aberrant_captain_cross.sql` (both artifacts committed alongside the
  journal/snapshot in the same change, per the 2026-08-14 lesson on that);
  (5) `AgentsService.stats()`'s N+1 (`GET /agents/stats`) replaced with one
  `avgStatsForAgents` query grouped by `(agent_id, model)` in
  `run.repo.ts`, keyed by an `agentId IN (...)` list. `pnpm db:migrate` was
  deliberately NOT run (per this fix-loop's instructions) — only
  Testcontainers-backed `.it.test.ts` runs (which call `runMigrations`
  against their own ephemeral container) exercised the new migration.
  Verified: `cd server && tsc --noEmit` clean (only the pre-existing
  `reviewer-core`/`openai` errors, confirmed via `git status` on those exact
  files); `cd client && tsc --noEmit` clean (confirms the `.nullish()`
  choice above actually fixed the ripple, not just avoided investigating
  it); full unit suite 319/325 (6 failures = the documented
  `indexer-pipeline.test.ts` Windows flake); full `.it.test.ts` suite 78/80
  (2 failures = the documented pre-existing `project-context-run.it.test.ts`
  AC-22/AC-26 `trace-builder.ts` gap) — both failure sets confirmed
  untouched via `git status` before concluding they're pre-existing, not
  caused by this session.

## Open Questions

- Why does `depgraph.buildEdges` leave `file_edges` empty for the demo
  orders/public import graph even after a full index on the PR tip? Name-
  matched callers paper over it; proper `decl_file` resolution is still the
  right long-term fix.
  **Confirmed still broken on a real, large repo, with numbers (2026-08-14):**
  this is not specific to the small `orders`/`public` demo fixture. Direct
  DB query against `AneliiaOleksiuk/dev-digest`'s own indexed clone (repo
  id `04f27d46-ee19-406a-9e6a-77befcb1f706`, a `full` index at commit
  `48bc3af`, `repo_index_state.stats`: `filesIndexed: 525`,
  `symbolsWritten: 1550`, `referencesWritten: 12912`) shows `file_edges`
  has **0 rows**, with no `graphFailed` key in `stats` — `buildEdges` ran
  to completion without throwing, it just found no import relationships in
  a real 5-package TypeScript monorepo that plainly has thousands.
  `file_rank` has 525 rows but only 1 distinct percentile (the degenerate-
  graph fallback in `pipeline/rank.ts:39-47` correctly kicking in given
  zero edges). Discovered downstream via the Onboarding Generator (SPEC-02)
  while manually verifying the live "Critical paths" section, which
  correctly reported "no usable import graph" rather than presenting the
  flat rank as real — so the symptom is now reproducible from a live
  feature, not just a DB query, if that helps debugging. Recorded in
  `BACKLOG.md` under "repo-intel — import-graph extraction".
- 2026-08-14: `test/project-context-run.it.test.ts`'s "AC-22: the second of
  two over-budget documents is dropped..." integration test fails
  (`Cannot read properties of undefined (reading 'map')` on
  `trace.project_context_docs`) on a clean run against this working tree —
  confirmed PRE-EXISTING and unrelated to the SPEC-02 onboarding session
  above via `git status` (zero changes from this session to
  `project-context/**`, `run-executor.ts`, or `trace-builder.ts`; the latter
  shows modified from an EARLIER uncommitted session, not this one). Left
  unresolved — it belongs to whichever session left `trace-builder.ts` mid-
  edit, not to onboarding. **Reconfirmed 2026-08-14 (fix-loop iteration 1
  below)**: still the only integration failure, still traced to the same
  uncommitted `trace-builder.ts`, still out of this session's scope.

- 2026-08-14 (SPEC-02 fix-loop iteration 1, remediating `plan-verifier`'s
  Phase 1 FAIL against commits `e8ca0ec`/`ea93e4d`/`8f04d73`) — six
  server-touching fixes:
  - **FIX-1 widened past what the fix plan described.** The plan assumed
    only migration `0017`'s journal/snapshot bookkeeping was missing. In
    fact TWO migrations were uncommitted: `0017_sweet_rachel_grey.sql`
    (onboarding — `.sql` itself WAS committed in `e8ca0ec`, only its
    journal entry/snapshot were missing, as the plan said) AND
    `0016_colossal_professor_monster.sql` (the SPEC-01
    `project_context_attachments` table — its `.sql` file itself was
    **also** never committed, from an entirely earlier, unrelated session;
    `git log -- <path>` shows zero commits touching it at all). Confirmed by
    dropping a scratch DB (`devdigest_scratch_fix1`) and running
    `pnpm db:migrate`-equivalent (`tsx src/db/migrate.ts` with
    `DATABASE_URL` pointed at the scratch DB) against the current working
    tree's `migrations/` folder as-is: both tables land correctly (all ten
    onboarding columns + `project_context_attachments` with its FKs/indexes),
    and the three snapshot files' `id`/`prevId` chain (`0015`→`0016`→`0017`)
    is internally consistent — so the CONTENT is correct, only the git
    history is missing it. Left uncommitted per this run's instructions (no
    commit requested), but flagged here since a future session might assume
    "0017's bookkeeping" is the whole story and miss that 0016's own `.sql`
    is homeless too.
  - **FIX-2**: `groundBulletItemPaths` (`onboarding/helpers.ts`) closes the
    W7 gap — AC-7 grounding previously only filtered `section.links`, never
    scanned `section.body` prose for invented paths. Scans single-backtick
    inline-code tokens per bullet/numbered item (reusing the existing
    `BULLET_RE` line-ownership logic from `capBulletItems` and the existing
    `knownPaths(facts)` allowlist); a token that "looks like a path"
    (contains `/`, or ends in a recognized source/doc extension) and isn't
    in the allowlist drops the WHOLE item, not just the token. Applied only
    to `critical_paths`/`reading_path`/`first_tasks` (per the fix plan's
    explicit scoping) — `run_locally` keeps its own verbatim-match grounding,
    `architecture` is deliberately untouched. Order matters: grounding runs
    BEFORE `capBulletItems`, so the render cap counts only survivors.
  - **FIX-3**: `OnboardingService.getTour`'s no-stored-row branch now calls
    the SAME `deriveStatus(indexState, facts)` the below-minimum generation
    branch already used, instead of hardcoding `never_generated` — this was
    `test-writer`'s own intentionally-failing oracle test
    (`onboarding.it.test.ts:234`, "no local clone renders `no_clone`, not
    `never_generated`, on the FIRST GET"); it now passes with zero test
    changes, exactly as the fix plan predicted.
  - **FIX-4 (server half)**: added `IndexState.bounded?: boolean` — a NEW
    field on an EXISTING return type, deliberately not a new facade method
    (judgment call: the Plan's Non-goal only forbade new facade *methods*).
    `RepoIntelRepository.tryGetIndexState` derives it from
    `stats.bounded > 0` (`pipeline/walk.ts`'s `WalkStats.bounded`, already
    persisted into `repo_index_state.stats` but never read back out before
    this fix). `onboarding/helpers.ts`'s `deriveStatus` now treats
    `indexState.bounded` the same as `status === 'partial'` — a `status:
    'full'` index that was walk-bounded at `MAX_INDEXED_FILES` now correctly
    reports `partial_index` to the Onboarding Generator instead of an
    unqualified "full index" claim (E-5/AC-15). This field is additive/
    optional — no ripple into any hand-built `IndexState` literal elsewhere.
  - **FIX-5**: `groundRunLocallyBody` now attributes each surviving,
    verbatim-matched command line with a trailing shell comment
    (`  # from <path>`) instead of just the skeleton path having
    attribution — deliberately NOT the skeleton's `(from \`path\`)`
    markdown-bullet convention, since that syntax would break INSIDE a
    fenced code block; a shell `#` comment is both valid shell syntax and
    consistent with `extractDeterministicCommands`' existing
    `npm run <script>  # <script body>` style.
  Client-side FIX-4/FIX-6 work is `client/INSIGHTS.md`'s entry for the same
  date. Verified: `pnpm arch:check` clean; server `tsc --noEmit` clean
  (except the one PRE-EXISTING `adapters/auth/local.ts:40` error, confirmed
  via `git status` as belonging to an unrelated concurrent session, not
  touched here); full onboarding unit + `.it.test.ts` suites green
  (27 + 19 tests, including the now-passing former "known failing" AC-18
  case); only pre-existing failures elsewhere (`indexer-pipeline.test.ts`'s
  documented Windows flake, `project-context-run.it.test.ts`'s AC-22 case
  above) — both confirmed unrelated via `git status` before and after.
- 2026-08-14 (FIX-8, mid-loop addition after FIX-1..7): `OnboardingSection`
  gained a `tasks: z.array(OnboardingTask).nullish()` field (both vendor
  `knowledge.ts` copies) so `first_tasks` can carry structured per-task cards
  (title/path/complexity) instead of only prose — same additive/nullish
  pattern `diagram` already uses for being architecture-only. **A per-kind
  constraint on an array item that must still share one object shape with
  its siblings composes better as `.superRefine` on the item schema than as
  a discriminated union**: `OnboardingLlmResponse`'s existing order/length
  check already does `sections[i].kind === ONBOARDING_SECTION_KINDS[i]`
  across ALL five items uniformly, so narrowing `OnboardingLlmSection` into a
  discriminated union keyed on `kind` (to make `tasks` required-only-for-
  `first_tasks` at the type level) would have fought that existing array-wide
  check rather than compose with it. `OnboardingLlmSection`'s own
  `.superRefine` instead enforces both directions post-hoc: `first_tasks`
  MUST have a non-empty `tasks` array, every other kind MUST leave it
  null/omitted — same one-schema-object shape, no union needed.
  **This ripples into `server/test/onboarding.it.test.ts`'s shared
  `VALID_SECTIONS`/`VALID_FIXTURE` fixture (line ~72), exactly the "extending
  a Zod contract ripples into every hand-typed object literal" pattern this
  file already documents for `PrIntentRecord`/`risk_areas`** — that fixture's
  `first_tasks` entry has no `tasks` field, so EVERY "successful generation"
  in that file now fails the new `superRefine` and falls through to the
  `llm_failed`/skeleton path instead of persisting a real tour. Confirmed via
  a live run: exactly 8 of 21 tests fail as a result (all downstream of "the
  fixture's generation never actually succeeds," not 8 independent bugs) —
  `AC-5`, `AC-23`, `AC-26`, `AC-28`, `AC-36`, `AC-21 (the marquee sequence)`,
  `D-13`, and `FIX-4 (bounded index)`. The fix is a ONE-LINE addition to the
  shared fixture (give its `first_tasks` entry a non-empty `tasks: [...]`),
  not 8 separate test rewrites — `test-writer`'s job next, flagged here so it
  isn't mistaken for a real regression in each of those 8 ACs individually.
  Grounding: `groundTasks(kind, tasks, paths)` in `helpers.ts` applies the
  SAME discard contract AC-7/D-8 already require for `links[].path`, to
  `tasks[].path`, then caps at the EXISTING `MAX_FIRST_TASK_CARDS` (no second
  cap invented). Client-side FIX-8 work (per-task card grid replacing the
  single header badge) is `client/INSIGHTS.md`'s entry for the same date.
  Verified: `pnpm typecheck`/`pnpm arch:check` both clean; onboarding unit
  suites (`onboarding-helpers.test.ts`, `onboarding-prompt.test.ts`) fully
  green (46/46, zero changes needed); `onboarding.it.test.ts` shows exactly
  the 8 predicted failures above, all traced to the one fixture gap, not
  fixed here per this fix-loop's own "test-writer's job next" convention.

- 2026-08-23: SPEC-04 Multi-Agent Review — G1 (Schema + contracts) of a
  4-group multi-agent plan (`docs/plans/spec-04-multi-agent-review.md`),
  a **blocking prerequisite** for G2 (server orchestration)/G3 (client UI),
  which build against the shapes landed here. `agent_runs` gained a nullable
  `multi_agent_run_id` FK (`onDelete: 'set null'`, matching the sibling
  `agentId`/`prId` FK pattern on the same table — NOT cascade, so deleting a
  batch parent never deletes its child runs' data) plus an index
  (`agent_runs_multi_agent_run_id_idx`) since every batch read selects
  children by parent id; required converting `agentRuns`'s `pgTable` call from
  the 2-arg form to the 3-arg `(table, columns, extra)` form other schema
  files already use for indexes (see `repos.ts` for the established pattern).
  `eval_cases.owner_kind` gained `'finding'` — confirmed live via
  `pnpm db:generate` that a Drizzle `text(col, {enum:[...]})` produces **zero
  SQL** for an enum-member addition (it's TS-level only, no CHECK
  constraint) — the generated migration `0019_soft_spirit.sql` touches only
  `agent_runs` (ADD COLUMN + FK + CREATE INDEX), confirming the plan's own
  "Facts verified while planning" note. `observability.ts` (both hand-mirrored
  copies) extended: `AgentColumn.status` gained `'cancelled'`; new
  `FindingGroupMember` (verbatim per-agent finding fields: `id`, `run_id`,
  `agent_id`, `agent_name`, `severity`, `title`, `rationale`, `suggestion`,
  `confidence` — AC-24 forbids paraphrase/merge, so this is a straight
  projection of `Finding`, not a rewrite) and `FindingGroup` (`file` +
  `normalized_file` + line range + `category` + `members`); `MultiAgentRun`
  gained `groups: z.array(FindingGroup)` and `total_cost_partial: z.boolean()
  .default(false)` (OQ-1's "badge as partial" default — a run with a null
  `cost_usd` sets this true rather than silently under-reporting the sum).
  **The "extending a Zod contract ripples into hand-built object literals"
  pattern this file documents repeatedly (`PrIntentRecord`/`risk_areas`,
  `first_tasks`/`tasks`, etc.) did NOT apply here** — grepped both `server/src`
  and `client/src` (app code and tests) for `MultiAgentRun`/`AgentColumn` and
  found zero consumers anywhere outside the contract file itself; these are
  brand-new L07 types with no existing callers, so G2/G3 are each contract's
  *first* real consumer, not a ripple-fix. Confirmed both vendor copies
  byte-identical via `git diff --no-index` (empty) and that both shapes
  actually parse (`AgentColumn` with `status: 'cancelled'`, `MultiAgentRun`
  with a non-empty `groups` array and `total_cost_partial` correctly
  defaulting to `false` when omitted) via a throwaway `tsx` script run from
  inside `server/` (deleted after). `server`/`client` `tsc --noEmit` both
  clean (server's only errors are the pre-existing, unrelated
  `reviewer-core`-has-no-`node_modules` / `openai`-type-inference errors,
  confirmed present identically on a `git stash` of this session's changes).
  Neither package's `node_modules` existed at session start — `pnpm install`
  was required in both before any build tooling could run.

- 2026-08-23: SPEC-04 Multi-Agent Review — G4 (Agent roster) of the same
  4-group plan, concurrent with G2/G3. Added three new built-in reviewer
  personas — Junior Mentor, Customer-Facing, Architecture — to
  `server/src/db/seed-prompts.ts` and `seedAgents` in `server/src/db/seed.ts`
  (six built-ins total now), each hand-mirrored into a new
  `docs/agent-prompts/{junior-mentor,customer-facing,architecture}.md`.
  Confirmed byte-identity between each TS template-literal body and its `.md`
  mirror programmatically (a throwaway Node script that extracts the
  template-literal content between the unescaped opening/closing backticks,
  un-escapes `` \` ``, and string-compares against the `.md` file with its
  trailing newline stripped) rather than eyeballing — worth reusing that
  script shape for any future prompt mirror instead of a manual diff, since a
  single missed `\`` escape is easy to miss by eye. **Idempotency of
  `seedAgents`'s name-lookup-then-insert guard was verified LIVE, not just by
  code reading**: Docker/Postgres was already up this session, so
  `DATABASE_URL=postgres://devdigest:devdigest@localhost:5432/devdigest
  ./node_modules/.bin/tsx src/db/seed.ts` (no `.env` file exists in this
  checkout — `DATABASE_URL` must be passed explicitly, from `.env.example`'s
  default) was run twice in a row; a direct `count(*) group by name` query
  against `agents` showed exactly 1 row per name both times (8 total in this
  workspace — the 6 new/original built-ins plus 2 pre-existing course-lesson
  agents from earlier sessions, `API Contract Reviewer` and
  `Test Quality Reviewer`), confirming no duplicate rows on re-seed.
  `server` `tsc --noEmit` showed zero new errors from this work item — the
  same pre-existing `reviewer-core`-has-no-`node_modules` errors documented
  in the entry above (unrelated files, confirmed by content not appearing in
  `seed-prompts.ts`/`seed.ts`).

- 2026-08-23: SPEC-04 Multi-Agent Review — G2 (Server orchestration,
  derivation, routes) of the same 4-group plan, concurrent with G3 (client)/
  G4 (agent roster). `run-executor.ts` was NOT touched (hard boundary).
  New: `multi-agent-service.ts` (orchestration — validates the agent-id set
  against the caller's workspace BEFORE any row is created, IDOR guard;
  creates one `multi_agent_runs` parent + N `agent_runs` children; fans out
  via `p-queue(concurrency:3)` calling `executor.executeRuns(...)` ONCE PER
  AGENT with a single-element `jobs` array — the hard rule from the plan),
  `multi-agent-derive.ts` (pure — union-find near-duplicate grouping with the
  ±3-line/≤20-line-span expansion rule, plus per-location conflict
  derivation), `multi-agent-read.ts` (batch read assembling `MultiAgentRun`,
  wall-clock `total_duration_ms`, `total_cost_partial`), `eval-case.ts`
  ("Turn into eval case"), `repository/knowledge.repo.ts` (memory + eval_cases
  writes/lookups). Extended: `diff-loader.ts` (bounded `Map`-based
  memoization keyed `${pull.id}:${pull.headSha}`, + `resetDiffCache()`),
  `findings.ts` (`'learn'` case added to the accept/dismiss switch),
  `run.repo.ts`/`review.repo.ts`/`repository.ts` (new methods per WI4),
  `routes.ts` (both modules), `agents/service.ts` (`stats()` using
  `container.reviewRepo.avgStatsForAgentModel` — a legitimate cross-cutting
  DI read, same pattern `ReviewService` already uses for
  `container.agentsRepo`).

  **Why `diff-loader.ts` needed memoization, concretely**: the plan's hard
  rule (call `executeRuns` once per agent, single-element `jobs` array, to
  keep `RunLogger`'s per-run buffer private) means an N-agent batch calls
  `loadDiff` N times for the SAME PR. Without the cache each of those would
  independently hit `container.git.diff`; the `Map<string, Promise<UnifiedDiff>>`
  keyed by `${pull.id}:${pull.headSha}` collapses all N into exactly one real
  load (concurrent callers share the SAME in-flight promise, not just
  sequential ones) — verify this by asserting the mock git client's `.diff`
  call count is 1 after an N-agent batch, not asserting cache internals.

  **Ordering, not locking, for the shared intent classification**:
  `MultiAgentService.executeBatch` calls `loadDiff` + ONE
  `intentService.getOrClassify` and AWAITS it before starting the p-queue
  fan-out. This is best-effort (wrapped in try/catch, degrades silently) —
  its only purpose is to get the `pr_intent` row PERSISTED before the N
  per-agent `executeRuns` calls each independently call `getOrClassify` again
  internally; `IntentService`'s own head-sha cache check then makes every one
  of those N calls a cheap DB-read cache hit instead of N racing LLM calls.
  If this pre-call itself fails, correctness is unaffected — each per-agent
  call just falls back to its own independent best-effort classify, exactly
  like the single-agent path already does.

  **`AgentColumn` (contracts/observability.ts, shipped by G1) has NO
  dedicated error-text field** — confirmed by re-reading the actual shipped
  file, not trusting the plan's paraphrase (which said "Columns carry...the
  persisted error text"). `vendor/shared/**` is this work item's explicit
  do-not-touch, so rather than silently dropping a failed/cancelled run's
  `agent_runs.error` text, `multi-agent-read.ts`'s column-mapping folds it
  into `summary` ONLY when the column has no real review summary (the normal
  case for a failed run, which never reaches `insertReview`). This is a
  pragmatic workaround, not a fix — **flagging for whoever owns
  `contracts/observability.ts` next: `AgentColumn` should probably grow a
  proper `error: string | null` field** so a future consumer doesn't have to
  guess whether a non-null `summary` on a failed column is a real review
  summary or a smuggled error string.

  **`EvalOwnerKind`/`EvalCase.owner_kind` in `contracts/knowledge.ts` is
  STILL `z.enum(['skill', 'agent'])`** — only the DB column
  (`db/schema/eval.ts`'s `eval_cases.owner_kind` text enum) was widened to
  include `'finding'` by G1; the shared Zod contract was not. Since no route
  in this codebase validates its OUTGOING body against `EvalCase.parse()`
  (confirmed by grep — every GET/POST here returns a plain object, no
  response-schema enforcement), `eval-case.ts`/`knowledge.repo.ts` return a
  locally-typed `{ eval_case_id: string }` / `EvalCaseRow` rather than
  routing through the (currently too-narrow) shared `EvalCase` type — this
  works today but is the same kind of gap as the `AgentColumn.error` one
  above: **`EvalOwnerKind` should eventually gain `'finding'` too**, in
  vendor/shared, by whoever's scope that is.

  **`arch:check`'s regex is anchored to the exact basename `service.ts`/
  `routes.ts`/`helpers.ts`, not a suffix match** — `multi-agent-service.ts`,
  `multi-agent-read.ts`, `multi-agent-derive.ts`, and `eval-case.ts` are all
  invisible to every one of the four dependency-cruiser rules (confirmed by
  reading `.dependency-cruiser.cjs`'s `path: '^src/modules/[^/]+/service\\.ts$'`
  literally — `[^/]+/service\.ts$` requires the path segment right after the
  module folder to be the literal string `service.ts`, so a same-folder file
  with a different basename never matches, regardless of what it imports).
  `modules/reviews`/`modules/agents` are ALSO both in `PRE_EXISTING_MODULES`
  already, so none of this session's touched files were EVER going to be
  checked by tooling either way — every "no service file imports Drizzle/
  schema directly" claim in this entry was verified by manual read, not by a
  green `pnpm arch:check` (which does report clean, unsurprisingly, given
  both gaps stack).

  Verified: `cd server && ./node_modules/.bin/tsc --noEmit` clean (only the
  pre-existing `reviewer-core`/`openai`-type-inference errors, confirmed via
  `git status` on those exact files showing no session changes);
  `pnpm arch:check` clean (214 modules, 770 deps, 0 violations — see caveat
  above about what that does and doesn't prove here); full unit suite green
  (319/325, the 6 failures all the documented `indexer-pipeline.test.ts`
  Windows flake, confirmed untouched via `git status`); full `.it.test.ts`
  suite green (78/80, the 2 failures both the documented pre-existing
  `project-context-run.it.test.ts` AC-22/AC-28 `trace-builder.ts` gap,
  confirmed untouched via `git status`) — Docker's first `docker info` call
  this session timed out at the helper's 5s limit (reported "Docker not
  available", all 78 DB-dependent tests skipped) on a cold Docker Desktop
  daemon; a second run immediately after (daemon now warm) picked up all of
  them correctly — if `dockerAvailable()` reports false on the FIRST
  integration run of a session, retry once before concluding Docker really
  isn't reachable.
- 2026-08-20: L06-Evals Phase A (`docs/plans/eval-pipeline.md` WI1/WI2, on
  `L06-Evals-homework`) — contracts + schema only, no module code yet.
  `EvalExpectation`/`EvalExpectationEntry` (versioned, `match_scope: 'range'
  | 'file'` per Q-6), `EvalBatchRecord`, `EvalComparison`,
  `EvalCaseFromFindingInput`, `EvalCaseRecord` (with `expectation_status`
  degrade-on-parse-failure) added to `eval-ci.ts`;
  `EvalCaseInput.expected_output` moved off `z.unknown()`;
  `EvalDashboard`/`EvalTrendPoint` widened to nullable metrics/delta per the
  plan's Recommendation 1. Hand-mirrored to the client copy — see the new
  Tool & Library Notes entry above for the pre-existing drift that had to be
  reconciled to make the two files byte-identical. New `eval_batches` table
  + `eval_runs.batch_id` + two new indexes (`db/schema/eval.ts`), migration
  `0019_unique_gravity.sql` generated cleanly (see the other new Tool &
  Library Notes entry — no interactive prompt for this pure-ADD change).
  Docker was not running this session, so `pnpm db:migrate` was **not** run
  against a live database — verified via `tsc --noEmit` only (both packages
  clean) plus the required `--no-index` byte-identity check. Phases B–E
  (module scaffold, case CRUD, scorer, batch runner, read APIs, client,
  gate script) are separate `implementer` passes per the plan's phasing.

- 2026-08-20 (later, same day): L06-Evals Phase B (`docs/plans/eval-pipeline.md`
  WI3-WI6, on `L06-Evals-homework`) — new `modules/eval/` (onion port/adapter:
  `repository.ts`/`repository.drizzle.ts`/`helpers.ts`/`service.ts`/
  `routes.ts`/`constants.ts`/`scorer.ts`), `container.evalRepo` (lazy getter +
  `ContainerOverrides.evalRepo`, mirrors `briefRepo`), registered in
  `modules/index.ts` as `eval: evalModule` (import renamed off the reserved
  word `eval`; the OBJECT KEY `eval` is fine, only the binding identifier
  can't be named that in strict-mode ESM). Case CRUD
  (`GET/POST/PATCH/DELETE /eval-cases`, `GET /agents/:id/eval-cases`) with
  tenancy-first + `owner_id` IDOR resolved through `AgentsService.get`
  (never a raw id comparison), `MAX_INPUT_DIFF_BYTES` cap, and read-side
  degrade-not-crash for a corrupt `expected_output` row
  (`expectation_status: 'unusable'`). One-click `POST /findings/:id/eval-case`
  derives everything server-side (expectation kind from
  `accepted_at`/`dismissed_at`, `match_scope` from `findings.kind` via the
  module-local `FULL_FILE_KINDS` mirror, owner from `reviews.agent_id`) and
  refuses-and-writes-nothing on a pending finding / null-`agent_id` review /
  patchless file / foreign-workspace finding. `scorer.ts` (WI6) is fully
  pure — zero imports beyond the module and shared contract TYPES — see the
  two new Codebase Patterns entries above for the `Container`-in-`service.ts`
  precedent question this surfaced and the local-join-reimplementation
  pattern. Verified: `tsc --noEmit` clean, `depcruise --config
  .dependency-cruiser.cjs src` clean (216 modules, 765 deps, zero
  violations), full unit suite green except the pre-existing
  `indexer-pipeline.test.ts` Windows flake (confirmed via `git status` —
  file untouched this session, matches the existing Recurring-Errors-&-Fixes
  entry), vendored `eval-ci.ts` byte-identity (`git diff --no-index`) still
  clean (Phase B touched zero contract/schema files). No migration needed —
  Phase A's `eval_cases` table shape already covered every field this phase
  writes. Phase C (batch runner, WI7-WI8), Phase D (client), Phase E (gate
  script) are separate `implementer` passes per the plan's phasing. Test
  authorship (`test-writer`'s job next) not attempted beyond the pre-existing
  suites passing.

- 2026-08-20 (later, same day): Targeted fix pass on Phase A per
  `plan-verifier`'s Phase 2 architecture review (two Major findings, both
  fixed rather than deferred). See the two new Tool & Library Notes entries
  above for the technical detail. Summary: `eval_batches.skills_fingerprint`
  is now not-null with a raw-SQL `'[]'::jsonb` default (was nullable, no
  default) and both vendored `EvalBatchRecord.skills_fingerprint` schemas now
  `.nullish().transform((v) => v ?? [])` instead of `.default([])`;
  `eval_runs` gained `findings_total`/`error` columns matching
  `EvalRunRecord`'s existing contract fields. One combined migration
  (`0020_early_korvac.sql`), applied both incrementally and via a
  from-scratch replay against live Docker Postgres (available this time,
  unlike the Phase A session). `tsc --noEmit` clean, `--no-index`
  byte-identity check clean, the existing 29-test
  `test/eval-ci-contracts.test.ts` suite passed unchanged (none of its
  existing assertions tested `skills_fingerprint: null` explicitly, so none
  encoded the bug being fixed — no test edits were needed or made).

- 2026-08-21: L06-Evals Phase C (`docs/plans/eval-pipeline.md` WI7/WI8, on
  `L06-Evals-homework`) — the version-pinned batch runner + zero-LLM-call
  read APIs. New `modules/eval/runner.ts` (pure orchestration: no DB, no
  `Container` — `runOneCase`/`runBatch` take an already-resolved
  `RunnerAgentSnapshot` + `LLMProvider`, run cases SERIALLY per Q-4, and
  never throw — a provider error/timeout/schema failure is caught and
  returned as a failed `CaseRunResult` so the caller's isolation loop needs
  no try/catch of its own). `AgentsService.linkedSkillsForRun` (additive,
  read-only) added so `service.ts` never imports `AgentsRepository`
  directly. `service.ts` gained `runForAgent`/`runOneCase` (funnel through
  one shared `runPinnedBatch`: in-process `workspaceId:agentId` concurrency
  guard, pin `agent_version`/`provider`/`model`/`skills_fingerprint` once,
  open a placeholder `eval_batches` row, run serially, persist each
  `eval_runs` row, close the batch with `scorer.ts`'s aggregate, one
  structured log line with counts/metrics/tokens/cost, never diff/prompt/raw
  response) and the five WI8 read methods (`getDashboardForAgent`,
  `getWorkspaceDashboard`, `listBatchesForAgent`, `getBatch`, `compare`), all
  workspace-scoped through the batch row (`eval_runs` itself still has no
  `workspace_id`). `repository.ts`/`repository.drizzle.ts` gained
  `insertBatch`/`closeBatch`/`insertRun` and the five read queries
  (`getBatchById`, `listBatchesForOwner`, `listRunsForBatch` via a LEFT JOIN
  to `eval_cases` for `case_name`, `listDashboardOwnerIds` via
  `selectDistinct` unioned in JS from both `eval_cases` and `eval_batches`,
  `countCasesForOwner`). Two new routes (`POST /agents/:id/eval-runs`,
  `POST /eval-cases/:id/run`, both rate-limited via the existing
  `EVAL_RUN_RATE_LIMIT`) and five new GET routes. One new unit test file
  (`test/eval-runner.test.ts`, plan-mandated: asserts the object passed to a
  mocked `reviewPullRequest` has no `callers`/`repoMap`/`specs`/`intent` key,
  per AC-18/D-2) — full AC-14..AC-33 test authorship is `test-writer`'s job
  next. Manually verified beyond the plan's minimum: Docker was actually up
  this session (see the new Tool & Library Notes entry above), so besides
  the required unit-level `tsc`/`depcruise`/`vitest --exclude '**/*.it.test.ts'`
  commands, also ran the pre-existing `eval-cases.it.test.ts`/
  `eval-create-from-finding.it.test.ts` (21 tests, unaffected — confirms no
  Phase-B regression) plus two THROWAWAY, not-committed integration checks
  against real Postgres via `app.inject()`: one exercising `runner.runBatch`
  directly (8 cases → 8 results, a mid-batch provider throw isolates to
  exactly one failed case, an all-throwing provider → `status: 'failed'`
  with every metric `null`), and one over real HTTP (8 cases → 8 `eval_runs`
  rows sharing one `batch_id`/`agent_version`, WI8 reads issue zero further
  LLM calls, a foreign-workspace batch id 404s, two concurrent
  `POST /eval-cases/:id/run` calls for the same case → one 201 + one 409 from
  the concurrency guard, and `compare()`'s `base_prompt` correctly comes back
  `null` for an agent created via raw DB insert with no `agent_versions` row
  — see the new "raw insert bypasses agent_versions snapshot" Recurring
  Errors & Fixes entry above, which THIS check surfaced). Both throwaway
  files deleted before this session's Implementation Report; test-writer
  owns the real, committed integration coverage next.

- **Two independently-built features can both register the SAME route with
  no compile-time warning — Fastify only catches it at boot (2026-08-23,
  merging `emdash/l07-multi-agents-xeu40` into `main`).** SPEC-04's own
  minimal `eval-case.ts` (`modules/reviews`) and L06-Evals' `modules/eval`
  both shipped `POST /findings/:id/eval-case` — text merge is silent about
  this class of conflict (different files, no line overlap), it only
  surfaces as `FastifyError: Method 'POST' already declared for route ...`
  when the merged app actually boots, which a pure `tsc --noEmit` pass does
  NOT catch (both route registrations typecheck fine in isolation). Always
  boot the merged app (or run a route-registration smoke test) after
  resolving a merge that touches `routes.ts` in more than one module, not
  just typecheck + unit tests. Resolved by keeping `modules/eval`'s
  `createFromFinding` (the fuller-featured implementation — derives the
  eval expectation from the finding's own accept/dismiss verdict, refuses
  422 on an undecided finding, owns the case by `agent`, not `finding`) and
  deleting SPEC-04's `eval-case.ts` + its now-dead
  `insertEvalCase`/`findEvalCaseByOwner` repository methods entirely, along
  with the obsolete AC-42/AC-44 test scenarios in
  `test/findings-learn.it.test.ts` that asserted the deleted
  implementation's behavior (a cross-workspace finding now 422s via
  `modules/eval`'s "not decided yet" check before it ever reaches an
  ownership check with a 422-shaped body-only finding, not the 404 the old
  code returned). The `eval_cases.owner_kind = 'finding'` enum member and
  its scoped partial unique index (`eval_cases_ws_owner_uq`) were left in
  the schema even though nothing writes that value anymore post-merge —
  removing them would have meant another migration under time pressure for
  zero behavioral gain; a harmless unused enum literal is a smaller risk
  than more schema surgery mid-merge.
