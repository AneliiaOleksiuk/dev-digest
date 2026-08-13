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

## Open Questions

- Why does `depgraph.buildEdges` leave `file_edges` empty for the demo
  orders/public import graph even after a full index on the PR tip? Name-
  matched callers paper over it; proper `decl_file` resolution is still the
  right long-term fix.
- 2026-08-14: `test/project-context-run.it.test.ts`'s "AC-22: the second of
  two over-budget documents is dropped..." integration test fails
  (`Cannot read properties of undefined (reading 'map')` on
  `trace.project_context_docs`) on a clean run against this working tree —
  confirmed PRE-EXISTING and unrelated to the SPEC-02 onboarding session
  above via `git status` (zero changes from this session to
  `project-context/**`, `run-executor.ts`, or `trace-builder.ts`; the latter
  shows modified from an EARLIER uncommitted session, not this one). Left
  unresolved — it belongs to whichever session left `trace-builder.ts` mid-
  edit, not to onboarding.
