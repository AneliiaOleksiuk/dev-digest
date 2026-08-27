# INSIGHTS — root

Accumulated engineering knowledge for this repo: what worked, what didn't,
codebase-specific patterns, tool quirks, and open questions — kept OUT of
[AGENTS.md](AGENTS.md) under the ≤100-line / map-not-documentation rule.

Read at the start of every session per AGENTS.md, and updated at the end via
the `engineering-insights` skill — treat entries here as high-confidence
guidance unless AGENTS.md says otherwise. Append-only; entries must pass the
"cold read" test (actionable without re-investigation) — see
[.claude/skills/engineering-insights/SKILL.md](.claude/skills/engineering-insights/SKILL.md).

## What Works

_(to be filled in)_

## What Doesn't Work

- **A Claude Code subagent calling `AskUserQuestion` does not get a live
  answer (2026-08-14).** `implementation-planner` and `spec-creator` both
  had explicit "call `AskUserQuestion`" instructions and, across four
  separate invocations this session, none of them actually invoked it
  interactively — every one instead wrote its questions as prose in the
  final chat report and proceeded on its own best guess. One instance
  said so directly in its own report: *"AskUserQuestion недоступний
  усередині субагента, тому я записав рішення як припущення."* A subagent
  spawned via the `Agent` tool runs non-interactively — it completes a
  turn and returns a result, it cannot pause mid-run for a human reply —
  so instructing it to "call AskUserQuestion" asks for something the
  runtime doesn't support, regardless of how explicit the wording is.
  **Fixed:** both personas (+ all 6 tool mirrors) now use a `## Blocking
  questions` section instead — stop before guessing, end the response
  with a structured question list in the same shape `AskUserQuestion`
  itself takes (header/question/2-4 labeled options), and don't write the
  plan/spec until resumed with the answers via a follow-up message. See
  `agents/implementation-planner.md`/`agents/spec-creator.md`'s "Blocking
  questions" section for the exact contract. Chat-native tools (Cursor,
  Codex) were never affected — there, asking was already a normal reply.
- **`skill-creator`'s benchmark only validates a skill's authored content,
  never its runtime behavior in this repo (2026-08-19).** Ran
  `skill-creator`'s old-vs-new comparison workflow on
  `.claude/skills/onion-architecture/` (added two rules — cross-module
  repository access, adapter-to-module imports — plus
  `evals/fixtures/case-4-analytics` and `case-5-digest`; results in
  `.claude/skills/onion-architecture-workspace/iteration-2/`). Its subagent
  runs don't call the `Skill` tool at all — they `Read` `SKILL.md`/
  `rules/*.md` directly and reason from that (done deliberately here, so the
  old-snapshot run couldn't accidentally load the live/new skill content by
  name). That means a 100%-vs-73% pass-rate delta only proves the *text* of
  the new rules changes what a reviewer concludes when handed the files
  directly — it says nothing about whether `onion-architecture` actually
  triggers on a natural prompt in a real Claude Code session, whether
  `implementation-planner`/`implementer`/`plan-verifier` invoke it during
  their normal SDD flow, how it interacts with `AGENTS.md`/`CLAUDE.md`
  project instructions, or whether `plan-verifier`'s Phase 2 (architecture
  review) catches the same violation when reviewing a real diff instead of a
  subagent reading isolated fixture files. Don't cite a skill-creator
  benchmark as evidence a skill "works in DevDigest" — it only shows the
  skill's instructions are internally sound. See the matching Open Questions
  entry below.

## Codebase Patterns

- **Why no monorepo tooling (pnpm workspaces / turborepo):** this is a course
  starter — each package is meant to be readable and runnable in isolation
  without a build orchestrator to learn first. Cross-package types are shared
  via tsconfig path aliases instead.
- **Why `@devdigest/shared` is hand-copied instead of a real package:** same
  reason — no workspace, no publish step. The trade-off is real drift risk
  (`server/src/vendor/shared/adapters.ts` still has a stale `apps/api/` path
  comment from whatever repo it was copied from) with no tooling to catch it.
- **`implementer`'s self-check split into per-item typecheck + one "Final
  self-check" (2026-08-12):** `agents/implementer.md` (+ 3 mirrors) used to
  run the full test suite and typecheck after *every* work item — for a
  5-item plan touching one package that's 5× full `vitest run` + 5× `tsc`
  output tokenized into context. Now: per-item is typecheck-only (cheap,
  short output on success), the full test suite runs once at the end under
  a new "Final self-check" section, with a quiet reporter
  (`--reporter=dot`) on the first pass. Trade-off accepted deliberately: a
  regression from an earlier work item may only surface at the end instead
  of immediately after the item that caused it — token savings over
  per-item fast feedback.
- **`plan-verifier` now reads `test-writer`'s Test Report, not just
  `implementer`'s (2026-08-12):** previously `test-writer`'s `Behavior
  mismatches found` section (bugs caught via its independent test oracle)
  had no defined downstream consumer — `plan-verifier`'s input contract
  (`agents/plan-verifier.md` Hard constraints) only listed `implementer`'s
  report. Fixed: a non-empty `Behavior mismatches found` entry is now a
  required Phase 1 traceability row (own `MET`/`NOT MET`/`NOT VERIFIED`
  verdict, evidence gathered independently — same context-decoupling rule,
  never trusted as evidence on its own) and a confirmed mismatch loops back
  to `implementer` exactly like a Phase 1 `FAIL`, per `agents/README.md`'s
  handoff-chain bullet list. Note the ordering this depends on:
  `test-writer` still runs *before* `plan-verifier` (unchanged) — Phase 1's
  re-run of the plan's `Test plan` commands already incidentally exercises
  test-writer's newly-added test files, so this fix formalizes what was
  already happening mechanically into an explicit traceability item.
- **`BACKLOG.md` (root, added 2026-08-14) tracks deferred follow-ups found
  mid-task** — real, concrete, out-of-scope issues discovered while
  executing an assigned task (a `plan-verifier` finding that's pre-existing
  and unrelated to the plan under review, a bug in starter infrastructure
  no lesson is meant to touch, a design decision explicitly deferred to a
  later pass). Not a roadmap or a wishlist — every entry cites the task it
  was found during and the exact file(s)/AC/commit involved, same
  evidence discipline as everything else this repo's agent chain produces.
  Distinct from `INSIGHTS.md`: this file is "things to do later," these
  files are "things to know now."

## Tool & Library Notes

- **`skill-creator`'s `scripts/aggregate_benchmark.py` silently produces an
  all-zero benchmark if `grading.json` sits one directory level too shallow
  (2026-08-20).** It only scans `<eval-dir>/<config>/run-*/grading.json` —
  a `grading.json` written directly at `<eval-dir>/<config>/grading.json`
  (no `run-N/` wrapper) is invisible to it, and the script does not error or
  warn; it just reports 0% pass rate / 0 tokens / 0 time for every
  configuration with no diagnostic pointing at the real cause. Same for
  `timing.json` and the `outputs/` dir — all three must live under
  `run-1/` (or `run-2`, etc.), not directly under `with_skill/`/
  `without_skill/`. Confirmed by comparing against a known-good existing
  layout (`.claude/skills/onion-architecture-workspace/iteration-1/eval-0-*/
  with_skill/run-1/grading.json`) after a first aggregation attempt on
  `pr-description-workspace` came back all-zero despite six real,
  individually-correct `grading.json` files existing one level too shallow.
  Fix: `mkdir <config>/run-1 && mv <config>/{outputs,grading.json,timing.json}
  <config>/run-1/` before running the aggregator, even for a single-run
  (non-repeated) benchmark.
- **`pnpm <script>` can abort with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`**
  in this Windows/PowerShell tool environment (no TTY attached) whenever pnpm
  detects any drift between the lockfile and `node_modules` and wants to
  reinstall — it refuses to proceed non-interactively instead of just
  reinstalling. `corepack pnpm <script>` hits the same wall. Workaround: call
  the already-installed binary directly, e.g.
  `.\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.json` and
  `.\node_modules\.bin\vitest.cmd run` from the package dir — skips pnpm's
  install-check entirely and still gives a real typecheck/test result.
  **Refinement (2026-08-09, `scripts/verify-l03.sh`):** the `.cmd` suffix
  above is specifically for a PowerShell caller. Under the Bash tool's Git
  Bash shell, npm/pnpm's bin-linking generates three shims per binary
  (`tsc`, `tsc.CMD`, `tsc.ps1`) and the **extensionless** one is a real POSIX
  shell script — `./node_modules/.bin/tsc` and `./node_modules/.bin/vitest`
  run directly with no suffix, no `pnpm exec`, and no `ERR_PNPM_ABORTED_…`
  risk. A cross-tool script that must work under both callers should invoke
  the extensionless form and let Git Bash resolve it; don't default to
  `.cmd` just because the environment is Windows.
- **Docker Desktop is not auto-started in this environment.** Any package
  needing Postgres (`server/`, and therefore a live `pnpm dev` client/API
  loop) can't come up until Docker is manually launched first — `docker ps`
  fails with a named-pipe connection error otherwise. Check `docker ps`
  before assuming a live end-to-end/browser verification is available in a
  given session; if it's down, either ask the user before starting it
  (multi-minute, visible action) or fall back to typecheck + test-suite
  verification and say so explicitly rather than claiming a live check.

## Recurring Errors & Fixes

- **Root `AGENTS.md` named non-existent mirror directories for cross-tool
  agent personas** (`.github/chatmodes/`, `.cursor/rules/`) while the real,
  documented locations were `.github/agents/` and `.cursor/agents/` — every
  mirror README (`.claude/agents/README.md` etc.) already used the correct
  paths, only the root map had drifted. Fixed 2026-08-06 alongside adding
  `test-writer`/`architecture-reviewer`/`plan-verifier`/`doc-writer`. If
  `agents/README.md`'s directory list ever changes again, grep root
  `AGENTS.md` for the old paths too — nothing keeps the two in sync
  automatically.
- **`git commit` with no pathspec commits the WHOLE staged index, not just
  what you `git add`ed in the current call (2026-08-13).** After `git add
  specs/SPEC-01-project-context.md` followed by plain `git commit -m
  "..."`, the resulting commit unexpectedly included 4 unrelated file
  renames (`planner.md` → `implementation-planner.md` across `.claude/`,
  `.codex/`, `.cursor/`, `agents/`) that had been staged in an earlier,
  separate piece of work and were still sitting in the index. `git commit`
  commits the full index by default — `git add` only adds to it, it
  doesn't scope the next `commit` call. **Fix used afterward:** `git
  commit -- <exact paths>` (or `git commit <exact paths>`, no `--` needed)
  commits only those paths and leaves the rest of the index staged for a
  later commit, without needing to `git reset` first. Always check `git
  status`/`git diff --cached --stat` immediately before a commit intended
  to be narrowly scoped, especially in a long session where earlier
  `git add` calls (yours or a prior session's) may still be pending.
- **pgvector queries return zero rows after embedding model rotation if the
  vector column dimensionality isn't updated (2026-08-20).** Changing from
  one embedding model to another (e.g., OpenAI `text-embedding-3-small`
  1536-dim → `text-embedding-3-large` 384-dim, or vice versa) silently breaks
  all similarity searches on tables still using the old dimension. The Postgres
  `vector` type does not enforce a dimension check at query time — distance
  functions like `cosine`, `inner_product`, or `l2` simply fail to match when
  dimensions don't align, returning zero results with no error. **Fix:** when
  rotating models, create a new column with the new dimension
  (e.g., `embeddings_v2 vector(384)`), re-embed all rows with the new model
  into it, run a migration to drop/rename columns if needed, and update queries
  to reference the new column. **Prevention:** Store the embedding model name
  and expected dimension in a schema comment or Drizzle migration so a future
  model change surfaces the mismatch during code review: `// Embedded with
  OpenAI text-embedding-3-small (1536-dim)` on the column definition.

- **`curl localhost:3000`/`:3001` from inside a git worktree can silently hit
  the wrong checkout (2026-08-23).** When multiple `pnpm dev` instances are
  running (main checkout + one or more worktrees), each worktree's client/API
  get auto-assigned the next free ports — e.g. main checkout on 3000/3001,
  a worktree's client/API on 3010/3011 — but they share the same Postgres,
  so `/repos`, `/agents`, etc. return identical-looking data on every port,
  giving no signal you're on the wrong one. A UI fix tested against
  `localhost:3000` rendered the *old* pre-fix markup with no error, because
  that server was serving the main checkout, not this worktree's edited
  files. **Fix:** before testing a worktree's UI change live, confirm the
  actual port via `Get-CimInstance Win32_Process -Filter "name='node.exe'"`
  (find the `next dev -p <port>` / `tsx watch src/server.ts` processes whose
  command line contains this worktree's path) cross-referenced with
  `Get-NetTCPConnection -State Listen`, and browse to that port — never
  assume 3000/3001 in a worktree session.

- **The shared `devdigest-postgres` container's migration state can drift
  ahead of a given branch/worktree's own migration folder, blocking `pnpm
  db:migrate` with a misleading "column already exists" error unrelated to
  the migration you're actually trying to apply (2026-08-27, SPEC-06 WI5).**
  Generated a purely-additive migration (`0023_...sql`, one `CREATE INDEX`)
  on `feat/agent-performance-dashboard`; running it failed with `column
  "token_hash" of relation "ci_installations" already exists` — a column
  this session's migration never touches. Diagnosis: `SELECT id FROM
  drizzle.__drizzle_migrations ORDER BY id DESC` showed the container had
  migrations applied up to id=26, while this checkout's `migrations/`
  folder only went up to this session's own 0023 (24 files total, ids
  0-23) — some OTHER branch/worktree had applied newer migrations directly
  to this SAME shared container, so drizzle's replay-by-hash logic hit a
  migration (0022, `ci_installations.token_hash`) whose column already
  exists from that other work, well before ever reaching the new 0023.
  **Do not attempt to fix this by hand-editing `__drizzle_migrations` or
  force-applying** — that risks corrupting migration state another
  session/worktree still depends on. This is a DIFFERENT failure mode than
  the port-collision entry above (that one is about which process answers
  `curl`; this one is about the shared container's actual schema/migration
  history outrunning your checkout) — if `pnpm db:migrate` fails on a
  column/table that your own migration doesn't touch, suspect this pattern
  first and diagnose via the migrations-count comparison above before
  assuming your own migration is broken. Testcontainers-backed
  `*.it.test.ts` files are unaffected — each spins up its own ephemeral
  container and migrates fresh from the checkout's files only (see
  `server/INSIGHTS.md`'s "Testcontainers-backed ... are fully
  self-contained" entry).
- **A `pnpm <script>` failure with `Cannot find module '<pkg>'` (Vite/tsx
  "Failed to load url ...") can be a plain missing install, not the
  documented `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` abort — check
  which one before reaching for the `.bin` shim workaround (2026-08-27).**
  `server/package.json` declared `yaml`/`jszip` as dependencies but neither
  existed under `node_modules/` in this session's environment (pre-existing,
  unrelated to any change made this session) — `tsc --noEmit` and `vitest
  run` both failed on `ci/manifest.ts`/`ci/service.ts` etc. importing them.
  A plain `pnpm install` (not `pnpm <script>`) resolved it in ~4s with zero
  TTY prompt (`+jszip +yaml`, `Done in 4.3s`) — the NO_TTY abort documented
  above specifically fires when pnpm detects lockfile/`node_modules` drift
  and wants to REMOVE-then-reinstall; a lockfile that's already up to date
  but has packages simply absent from `node_modules` installs cleanly
  without hitting that path. Try a plain `pnpm install` first; only fall
  back to the `.bin` shim workaround if that itself hits the NO_TTY abort.

## Session Notes

- 2026-08-02: Built the Skills feature end to end (spec at
  `specs/skills-feature.md`) — reusable markdown prompt fragments linkable
  to multiple review agents. Most of the data layer (`skills`/
  `skill_versions`/`agent_skills` tables, `GET/POST /agents/:id/skills`,
  the `parts.skills` prompt-assembly slot, the trace viewer's skills
  block) already existed from an earlier lesson; this session added the
  standalone `/skills` CRUD module, the client Skills page + Agent Editor
  Skills tab, file/URL import, the `run-executor.ts` wiring that actually
  populates the prompt, and a new "Test Quality Reviewer" agent + 4
  skills (3 manual, 1 via the real import endpoint). See `server/
  INSIGHTS.md` and `client/INSIGHTS.md` for the package-level details.
  Community-catalog search/import deliberately deferred (no data source
  exists yet). Verified live end-to-end via a real run (see `server/
  INSIGHTS.md`), not just typecheck — the seeded demo repo's PR has an
  unloadable diff locally (same file, Recurring Errors & Fixes), so the
  live verification targeted the trace's prompt-assembly content/token
  count rather than a findings diff on real code.

- 2026-08-02: Built the Conventions Extractor + API Contract Reviewer
  homework (spec at `specs/conventions-extractor.md`) — a repo-scanning
  feature that proposes house-rule candidates with LLM-generated evidence,
  grounds each candidate against the actual sampled file content before
  persisting, and lets a user promote accepted ones into a real Skill; plus
  a separate agent+skills demo showing the Skills feature's effect on
  review precision. See `server/INSIGHTS.md` and `client/INSIGHTS.md` for
  the package-level details. Cross-cutting takeaway: this local
  environment's OpenAI and Anthropic API keys were both exhausted
  (quota/credit) during this session — only OpenRouter worked — which is
  exactly the scenario the platform's per-feature model override
  (`Settings.feature_models`) exists to route around without a code
  change; worth checking `POST /settings/test-connection` per provider
  before assuming an LLM-backed feature that fails is a code bug.

- 2026-08-06: Added four new cross-tool subagent personas — `test-writer`,
  `architecture-reviewer`, `plan-verifier`, `doc-writer` — to the
  `agents/` system (canonical `agents/<name>.md` + 4 hand-mirrored copies
  each: `.claude/agents/`, `.codex/agents/`, `.github/agents/`,
  `.cursor/agents/`), extended the handoff chain in all 5 READMEs
  (`agents/README.md` + the 4 mirror READMEs), amended `agents/implementer.md`
  (+ its 4 mirrors) so it no longer claims new-test authorship, and fixed
  root `AGENTS.md`'s stale mirror-directory paths (see Recurring Errors &
  Fixes). 16 new files, 8 files updated, zero product code touched
  (`server/src`, `client/src`, `reviewer-core/src`, `e2e/` all untouched by
  design — this was purely repo-tooling). See `agents/README.md` for the
  full 7-agent handoff chain and each new persona's file for its
  `### Sources` grounding.

- 2026-08-06/07: Intent Layer shipped end to end (plan at
  `docs/plans/intent-layer.md`) — classify PR intent/scope via a cheap
  flash-class LLM call, persist on `pr_intent`, show on PR Overview,
  inject into the reviewer prompt with model-owned scope guidance.
  Package detail in `server/INSIGHTS.md` and `client/INSIGHTS.md`; prompt
  assembly docs in `docs/agent-prompts/README.md`.

- 2026-08-07: Cut token cost of the `agents/` dev-subagent chain
  (planner → implementer → test-writer → plan-verifier → doc-writer;
  `planner` renamed `implementation-planner` 2026-08-12, see below),
  purely repo-tooling, zero product code touched. Four changes, in order
  of what actually moved the needle:
  1. **Dropped GitHub Copilot mirroring entirely** — `.github/agents/`
     deleted (7 files), all "four mirrors" language in `agents/*.md` and
     the three remaining tool READMEs changed to "three." One fewer
     hand-mirror target going forward, permanently.
  2. **Merged `plan-verifier` + `architecture-reviewer` into one agent**
     (`plan-verifier` survives, absorbs the other as a strictly-ordered
     "Phase 2" — Phase 1's `VERDICT:` line locks before Phase 2 opens, so
     the merge can't let architecture judgment bleed into the
     spec-compliance verdict). Cuts one full cold-start agent invocation
     per chain run. `implementer`/`test-writer` were deliberately **not**
     merged — that split protects test-oracle independence, a different
     (and non-negotiable) property than "these two happen to run
     back-to-back." See `agents/README.md` §"Why plan-verifier and
     architecture-reviewer merged" / §"What was deliberately NOT merged"
     for the reasoning, in case a future session is tempted to also merge
     `implementer`+`test-writer` for the same "sequential = mergeable"
     logic — it does not apply there.
  3. **Added a "Context handoff convention"** (`agents/README.md`) —
     downstream agents (`implementer` onward) now accept the Development
     Plan / diff / `INSIGHTS.md` excerpts inlined directly in the prompt
     by whoever invokes them, instead of defaulting to fetching each one
     themselves via `Read`/`git diff`. This is a delivery-mechanism
     change only: `plan-verifier`'s context-decoupling rule (never trust
     `implementer`'s narrative as evidence) still applies whether the raw
     diff arrives inlined or self-fetched. Self-fetching remains the
     fallback when nothing was inlined, so every agent still works
     standalone.
  4. **Shortened static boilerplate** in `planner`(now `implementation-planner`)/`implementer`'s report
     formats (the "Explicitly out of scope"/"Out of scope (deferred)"
     sections were restating the same fixed list every single run) to a
     one-line pointer at `agents/README.md`#handoff-chain.
  Mechanical execution note: after I (Claude, Sonnet) made the judgment
  calls in the canonical `agents/*.md` files, the actual reformatting into
  `.claude/agents/`, `.codex/agents/`, `.cursor/agents/` was delegated to
  three parallel background subagents running on **Haiku**, each scoped to
  one tool directory with the finished canonical files as ground truth —
  dogfooding the "mechanical mirroring doesn't need the expensive model"
  recommendation this same session produced. Caught and fixed one thing
  the Haiku pass missed on manual verification: `.cursor/agents/README.md`
  still listed `.github/agents/` as a mirror target and said "other three
  tools" (should be two) after Copilot was dropped — worth a full-repo
  grep for `Copilot|four mirror|github/agents` after any future Haiku
  mirroring pass, not just trusting the subagent's own "verified clean"
  claim in its report.
- 2026-08-08: Built `mcp/` (`@devdigest/mcp`), a new standalone npm package
  exposing DevDigest's existing review capabilities to an MCP client over
  stdio (`list_agents`, `run_agent_on_pr`, `get_findings`, `get_conventions`,
  `get_blast_radius` stub) — a pure HTTP façade over the local API on
  `:3001`, no in-process `server/src` import (see `mcp/AGENTS.md` for why).
  Confirmed the plan's zod-major risk was moot in practice:
  `@modelcontextprotocol/sdk`'s peer range (`zod: "^3.25 || ^4.0"`) is
  satisfied by npm resolving the repo's existing `^3.24.1` pin up to
  `zod@3.25.x` — one zod instance, no zod-4 split needed. Also confirmed
  `CallToolResult.structuredContent` must be a JSON object, not a bare
  array — an SDK constraint the plan's literal `AgentSummary[]` /
  `ConventionSummary[]` output typing didn't anticipate; both tools wrap
  their array under a top-level key instead. See `mcp/INSIGHTS.md` for the
  package-level detail (SDK API shape, test-harness pattern, stdio spawn
  verification).

- 2026-08-09: Added `scripts/verify-l03.sh` (WI10 of
  `docs/plans/l04-followups-blast-inline-and-fixes.md`) — a root gate that
  runs server typecheck, server unit tests narrowed to the L03 suites
  (`intent-*`, `smart-diff-*`, excluding `**/*.it.test.ts`), client
  typecheck, and client's full `vitest run`, fail-fast with the failing lane
  named. Deliberately excludes `reviewer-core` (scoped to client+server per
  user decision) and never invokes `pnpm test`/`pnpm test run` — see the
  script's own header comment for the full rationale. Verified live: passes
  clean (exit 0) with Docker running (this session never needed to stop it —
  none of the four lanes touch Postgres); a deliberately introduced type
  error in `server/src/modules/smart-diff/service.ts` made it fail at lane 1
  with a non-zero exit as expected, then was fully reverted (`git diff`
  confirmed clean) before finishing. See the Tool & Library Notes entry
  above for the `.bin` shim nuance this surfaced.

- 2026-08-12: Renamed `planner` → `implementation-planner` across all four
  files (canonical `agents/` + three tool mirrors) plus every cross-referencing
  file (`agents/README.md` and its three mirrors, `agents/implementer.md`,
  `agents/doc-writer.md`, `agents/plan-verifier.md`, and their mirrors) —
  not just a label change: the persona now explicitly never authors, edits,
  or completes anything under `specs/`, closing a real ambiguity where
  `doc-writer.md` described `specs/` as `human/planner`-owned (implying
  shared ownership). It's now `human-owned` only. Two new required steps
  were added to the persona: a "Requirements review" step (read `specs/*.md`
  if one exists, ask about gaps, and surface a `Recommendations` section —
  not just transcribe the request) and an "Execution mode" question, asked
  once before saving the plan, choosing multi-agent (full handoff chain) vs.
  single-agent (one pass, no downstream agents) — the choice is recorded
  under `Scope` in the Development Plan report so `implementer` doesn't have
  to guess it. Historical dated entries above (2026-08-07) were left as
  `planner` with an inline rename note rather than rewritten, since they
  describe what was true at that time.
  **Concurrent-work note:** mid-session, untracked `agents/spec-creator.md`
  (+3 mirrors) appeared — a new agent, apparently authored in a parallel
  session, that owns `specs/` as the *one* automated writer of it (SDD:
  `spec-creator` → `implementation-planner` → `implementer` → ...). Its
  `planner`-era references were updated to `implementation-planner` too,
  and it independently converged on citing this session's new
  "Not responsible for: specifications" section almost verbatim — treat
  `spec-creator.md` as the authoritative owner of the `specs/` template/
  workflow going forward, not something this entry's author designed.

- 2026-08-12: Audited the SDD agent chain
  (`spec-creator` → `implementation-planner` → `implementer` → `test-writer`
  → `plan-verifier` → `doc-writer`) on user request and made two targeted
  changes across canonical `agents/*.md` + all 9 mirror files (`.claude/`,
  `.codex/`, `.cursor/` × `implementer`/`plan-verifier`, plus 3 `README.md`
  files): (1) `implementer`'s test/typecheck self-check moved from
  per-work-item to once-at-the-end, to cut token cost of re-running full
  suites repeatedly; (2) `plan-verifier`'s input contract now explicitly
  includes `test-writer`'s Test Report, with a required Phase 1
  traceability row for any `Behavior mismatches found` and an explicit
  loop-back rule. See the two new Codebase Patterns entries above for the
  full rationale. Confirmed during the audit: the existing order
  (`test-writer` before `plan-verifier`, not after) should stay as-is — no
  change made there, just documented why.

- 2026-08-13: Project Context (SPEC-01) built server+client per
  `docs/plans/spec-01-project-context.md` (WI1–WI12 of 13; WI13 — live
  grounding verification on PR #3 — deliberately not attempted this session,
  see below). Makes a repo's own `specs/`/`docs/`/`insights/` Markdown
  discoverable, attachable to a Skill or Agent, and injected into the
  already-existing `PromptParts.specs` prompt slot at run time —
  `reviewer-core/` untouched throughout (confirmed via `git diff --stat`).
  Package detail in `server/INSIGHTS.md` and `client/INSIGHTS.md` (2026-08-13
  entries). Cross-cutting takeaway: extending a Zod contract with a new
  non-optional-with-`.default()` field (here, `RunTrace.project_context_docs`)
  ripples into every hand-typed object literal built against that schema's
  *output* type, not just its `.parse()` call sites — on both the server
  (`platform/trace-builder.ts`) and the client (a test fixture) this session,
  confirming the same pattern `server/INSIGHTS.md` already recorded for
  `PrIntentRecord`/`risk_areas`.
  **WI13 status**: Docker/Postgres was confirmed running this session
  (`docker ps`), but WI13's own approval gate — explicit human confirmation
  of the exact diff before pushing a commit to the real, shared
  `AneliiaOleksiuk/dev-digest#3` PR branch — could not be obtained within a
  single agent turn, so no push, no live LLM run, and no `eval_cases`/
  `eval_runs` rows were attempted. Reported as a blocked work item, not done
  and not silently skipped, per the plan's own instruction for this case.

- 2026-08-13: SPEC-01 plan-verifier fix-loop iteration 1 — four Phase-1
  NOT MET rows plus one approved Phase-2 Major. Cross-cutting: (1) vendored
  `trace.ts` comment drift (`T1.3`/`T3` vs `repo-intel`) is now reconciled
  by copying server comments onto client — `git diff --no-index` of the two
  files must stay empty; the older "don't fix this as a drive-by" note in
  `server/INSIGHTS.md` still applies to *unrelated* work. (2) Extending
  `ContextAttachmentSet` with `other_repo_documents: z.array(…).default([])`
  lets the Agent Context tab show other-repo attachments without a 7th
  HTTP endpoint; `.default([])` keeps Skill-tab fixtures parsing. Same
  `z.infer` output-type ripple as `project_context_docs` — test mocks that
  hand-build the object need the new field.

- 2026-08-14: Full SDD pipeline run for two features in one long session.
  **Track A** — amended SPEC-01 with three new decisions (coverage
  indicator, in-app document editing with a write-back-to-working-copy
  ADR, manual document creation), ran the whole chain (spec → plan → code
  → tests → plan-verifier PASS WITH REQUIRED FIXES, all three fixes
  pre-existing/out-of-scope, deferred to `BACKLOG.md` → docs), pushed
  `L05-SDD` merged into `main` on `origin` (the user's fork) so a
  resynced repo clone could actually see the new specs/plans for live
  testing. **Track B** — wrote SPEC-02 (Onboarding Generator) grounding
  a feature request against already-shipped-but-unwired scaffolding
  (`onboarding` table, `Onboarding*` contracts, a `FEATURE_MODELS` slot,
  a system prompt template, two unused `repoIntel` facade methods), ran
  the same chain through `plan-verifier`, which returned **VERDICT: FAIL**
  with 7 real findings (most severe: the Drizzle migration journal/
  snapshots were never committed, so the feature's DB columns don't exist
  on a fresh checkout) — captured as
  `docs/plans/spec-02-onboarding-generator-fixes.md` for the next
  fix-loop iteration rather than fixed same-session. Found and fixed two
  live bugs outside the plan via direct manual verification in a real
  browser (`client/INSIGHTS.md`, `server/INSIGHTS.md` have the specifics)
  and one confirmed pre-existing `repo-intel` bug (`depgraph.buildEdges`
  writes zero edges for a real, import-heavy repo — `BACKLOG.md`). Also
  fixed the `AskUserQuestion`-in-subagents problem across both planner
  personas (see What Doesn't Work) after the user noticed the pattern.

- 2026-08-19: Extended `.claude/skills/onion-architecture/` with two new
  boundary rules (cross-module repository access in
  `rules/dependency-rule.md`'s "Cross-module access" section; adapter-to-
  module imports in the same file's "Adapter-to-module imports" section —
  both include a ready dependency-cruiser snippet in `rules/enforcement.md`,
  not yet wired into the real `server/.dependency-cruiser.cjs`), added two
  eval fixtures (`evals/fixtures/case-4-analytics`,
  `evals/fixtures/case-5-digest`) and ran `skill-creator`'s old-vs-new
  benchmark across all 5 eval cases — results in
  `.claude/skills/onion-architecture-workspace/iteration-2/` (`benchmark.md`,
  `review.html`), old-version snapshot in
  `.claude/skills/onion-architecture-workspace/skill-snapshot/`. Both new
  rules were grounded in real pre-existing violations in this repo
  (`conventions/service.ts` → `repos/repository.ts`;
  `adapters/astgrep/index.ts` → `modules/repo-intel/constants.ts`), so
  neither is hypothetical. See the matching What Doesn't Work entry above
  for the methodology caveat (content-only comparison, no `Skill` tool
  invocation) and the Open Questions entry below for what a real
  workflow-level test would still need to cover.
- **A skill-creator benchmark's aggregate pass-rate delta can hide that most
  of its assertions weren't actually testing the skill (2026-08-20).** The
  `pr-description` benchmark (Session Notes below) looked like a clean win
  at the aggregate level (100% vs. 75%), but reading the per-assertion
  breakdown showed the entire delta was carried by exactly one assertion
  category — every other assertion passed in both the with-skill and
  baseline configurations across all 3 evals, meaning base Claude behavior
  already satisfied them unprompted. A skill's *measured* contribution can
  be much narrower than its aggregate score implies. Don't stop at the
  aggregate delta when deciding whether a skill "works" or which parts of it
  are worth keeping — read the per-assertion table (or the eval viewer's
  Outputs tab) and check which assertions actually flip between
  configurations.

- 2026-08-20: Ran a fresh skill-creator eval benchmark on
  `.claude/skills/pr-description/` (3 scenarios × with-skill/baseline, 6
  subagents against real local git fixtures under
  `evals/fixtures/case-{1,2,3}-*`, graded, aggregated — see
  `.claude/skills/pr-description-workspace/iteration-1/benchmark.json` and
  `review.html`). Aggregate pass rate: 100% with-skill vs. 75% baseline, but
  the per-assertion breakdown showed the entire delta came from exactly one
  assertion category (the Effort section's exact two-bullet format); every
  other assertion (draft-shown-before-`gh`, diff-grounded Scope bullets,
  honest "no browser tool" disclosure, explicit pushback on an adversarial
  "skip the draft" request) passed in both configurations across all 3
  evals. See the new What Doesn't Work entry below for what this implies
  about reading benchmark results. No skill changes made — testing only.

- 2026-08-20: Ran the L06-Evals "version A/B" exercise on the
  `architecture-reviewer` subagent (`evals/agents/architecture-reviewer/`,
  N=2 per phase — `eval:repeat` capped the requested N=3 to 2 for token
  economy). `.claude/agents/architecture-reviewer.md` no longer exists in
  this repo (merged into `plan-verifier`'s Phase 2 on 2026-08-07, see the
  2026-08-07 entry above) but the eval package still expects it on disk, so
  it was restored from `git show 8426e6d:.claude/agents/architecture-reviewer.md`
  for eval purposes only — not wired back into any production dispatch path.
  **Version B** = same file minus the "One rule citation per finding" hard
  rule. Result: the citation-shaped practices themselves
  (`names the exact documented rule identifier ...`) stayed 100%→100% in
  both configs — a strong-enough base model volunteers the identifier
  unprompted, exactly as `architecture-reviewer.cases.ts`'s own comments
  predicted. The practice that actually moved was
  `does not fabricate a documented-rule violation for a benign rename`
  (100%→50%), and it reproduced cleanly on revert
  (version-B→restored: 50%→100%). **One practice did NOT reproduce
  cleanly**: `does not fabricate an architecture finding for the
  out-of-scope security-shaped change` was already 50% in baseline *with*
  the rule present — reading the trajectory
  (`evals/results/outputs/20260819T215150/does-not-fabricate-an-architecture-finding-for-the-out-of-scope-...md`)
  showed the model volunteering a testability aside ("prevents tests from
  injecting mocks and makes the code harder to maintain"), which trips the
  practice's own "does not comment on ... test coverage" clause — a
  case/grader sensitivity unrelated to the rule edit, not a real regression.
  Confirms the general lesson: when a delta doesn't reproduce, check the
  trajectory before blaming the edit — it may be the case design flaking
  independent of what changed. Raw data:
  `evals/results/repeat-{baseline,version-B,restored}.json`.

  **Update (later session, same day):** the `git show 8426e6d:...`
  restore-for-eval-purposes-only workaround above got accidentally
  upgraded into a real, committed `.claude/agents/architecture-reviewer.md`
  (+ a new `-lite` sibling) while wiring CI around it — i.e. exactly the
  "wired back into a production dispatch path" outcome this entry says was
  deliberately avoided. Caught during a docs-cross-check pass. Fixed
  properly this time: both files now live only as eval fixtures
  (`evals/agents/architecture-reviewer/fixtures/architecture-reviewer.md`,
  `evals/agents/architecture-reviewer-lite/fixtures/architecture-reviewer-lite.md`),
  `agentContent()`/`agentTools()` (`evals/src/artifacts/load.ts`) fall back
  to that fixtures path when an agent isn't found in the real
  `.claude/agents/`, and the workflow-tier dispatch case
  (`evals/workflow/review-workflow.cases.ts`) now targets `researcher` (a
  real, currently-registered agent) instead — dispatch through
  `settingSources: ["project"]` only ever finds agents actually on disk in
  `.claude/agents/`, so a retired persona can't be a dispatch target
  without re-registering it, which is the thing to avoid.

## Open Questions

- **`reviewer-core/` is on npm while everything else is on pnpm:** unclear
  from the code — most likely an artifact of how the package was bootstrapped
  separately. Worth normalizing to pnpm if it ever causes friction; until then
  it's a known, harmless inconsistency, not a bug to "fix" reflexively.

- **The course has no workflow-level eval harness for `.claude/skills/*` —
  only `skill-creator`'s content-level one (2026-08-19).** After the
  onion-architecture old-vs-new run (see What Doesn't Work / Session Notes
  above), four things a course session might reasonably want to verify are
  still untested by any tool in this repo:
  1. **Activation** — does `onion-architecture` (or any skill) actually
     get selected by the `Skill` tool on a realistic user prompt in a live
     Claude Code session, given its current `description` frontmatter?
     Nothing here plays the role of the skill-creator "description
     optimization" loop (`run_loop.py`) against *this repo's* actual skills.
  2. **Dispatch** — when `implementation-planner` scaffolds a new
     `server/src/modules/<name>/`, or `implementer` builds it, does either
     one actually consult `onion-architecture` mid-task the way
     `agents/implementation-planner.md`/`agents/implementer.md` assume, or
     does it silently skip it? No SDD-chain run has been observed and
     checked for this specifically.
  3. **`AGENTS.md`/`CLAUDE.md` interaction** — do a skill's rules and the
     project's own `AGENTS.md`/`server/AGENTS.md` ever give conflicting
     guidance (e.g. do-not-touch paths, "not a monorepo" minimal-tooling
     stance vs. a skill recommending a new dependency), and if so which
     wins in practice? Untested either way.
  4. **`plan-verifier` Phase 2** — does the architecture-review phase
     actually catch a skill violation (e.g. the case-4/case-5 patterns
     above) when reviewing a real Development Plan's diff, the way this
     session's isolated fixture-reading subagents did? `plan-verifier.md`
     assumes skills inform its judgment but that path has never been
     exercised end-to-end and graded.
  No decision yet on whether this becomes a course lesson, a `agents/`
  addition, or stays out of scope — flagging so a future session doesn't
  assume skill-creator's benchmark already covers it.

- 2026-08-22: Added `scripts/verify-l06.sh` (Phase E, WI14/WI15 of
  `docs/plans/eval-pipeline.md`) — same five-lane shape as `verify-l03.sh`
  plus a new `depcruise --config .dependency-cruiser.cjs src` lane (Q-5,
  Recommendation 4): server typecheck, server `arch:check`, server unit
  tests narrowed to the four non-`.it.test.ts` L06 suites
  (`eval-ci-contracts`, `eval-helpers`, `eval-runner`, `eval-scorer`), client
  typecheck, client's full `vitest run`. Verified live exactly like
  `verify-l03.sh` got: the real `devdigest-postgres` container was actually
  `docker stop`ped (not just "assumed down") before the full run, confirming
  none of the five lanes touch Postgres; then a deliberate `number`/`string`
  type mismatch in `modules/eval/scorer.ts` made the script fail at lane 1
  with a non-zero exit and the lane named, then was fully reverted (`git
  diff` on the file empty, `git status` showing only the new script
  untracked) before restarting the container to leave the environment as
  found. WI16 (the validation experiment) is untouched by design — it is
  human-run, spends real provider money, and needs a browser; the same
  precedent as SPEC-01 WI13 (2026-08-13 entry above) applies.

- 2026-08-23: Phase A of `docs/plans/spec-04-export-to-ci.md` (WI1-WI4:
  extend + hand-mirror the CI contracts, `ci_installations`/`agent_runs`
  schema additions + generated migration `0021_wide_cerebro.sql`, add
  `yaml`+`jszip` to `server`, fix the root `.gitignore`'s inert
  `agent-runner/dist` negation) — contracts/schema/deps only, zero runtime
  behavior, per the plan's own no-test-writer-this-pass callout. Verified via
  `tsc --noEmit` (both packages), `git diff --no-index` on the two vendored
  `eval-ci.ts` copies (empty), and a real `pnpm db:migrate` against the live
  `devdigest-postgres` container (Docker was up; confirmed `ci_installations`
  had zero rows before applying the two new `NOT NULL`-without-default
  columns). See `server/INSIGHTS.md`'s matching 2026-08-23 entry for the
  package-level gotchas (Zod const-ordering TDZ trap, fresh-worktree
  `node_modules`, the shared-Postgres-container sanity check).
