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

## Recurring Errors & Fixes

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

## Open Questions

_(to be filled in)_
