# INSIGHTS — evals

Accumulated engineering knowledge for this package: what worked, what
didn't, codebase-specific patterns, tool quirks, and open questions — kept
OUT of [README.md](README.md). Append-only; entries must pass the "cold
read" test (actionable without re-investigation) — see
[../.claude/skills/engineering-insights/SKILL.md](../.claude/skills/engineering-insights/SKILL.md).

## What Doesn't Work

- **A `workflow` case cannot assert on a package-scoped `AGENTS.md`/`CLAUDE.md`
  rule while `workflowTask` runs from `REPO_ROOT`.** `workflowTask`
  (`src/tasks.ts`) always runs with `cwd: REPO_ROOT` and
  `settingSources: ["project"]`, which loads the root `CLAUDE.md` (`@AGENTS.md`)
  only — nested per-package files like `reviewer-core/CLAUDE.md` are **not**
  loaded unless the model navigates into that directory itself. A case that
  prompted about a "reviewer-core" problem and expected the model to follow
  `reviewer-core/AGENTS.md`'s own "read INSIGHTS.md" rule (reading
  `reviewer-core/INSIGHTS.md`) instead only ever saw the root rule and read
  the root `INSIGHTS.md`. Fix: either scope the case's expectation to what's
  reachable from root `AGENTS.md` alone, or extend `WorkflowCase`/
  `workflowTask` with a per-case `cwd` override (not present as of
  2026-08-20) if a package-scoped rule genuinely needs testing.
- **Re-importing a course lesson's older fixture docs verbatim is not a safe
  fix for a "file not found" eval case.** `workflow/review-workflow.cases.ts`
  referenced `server/docs/api-contracts.md`, `reviewer-core/docs/pipeline.md`,
  `reviewer-core/insights/gotchas.md` — leftovers from the old monolithic
  `CLAUDE.md` course-lesson state (`upstream/evals-example`, with an explicit
  `## Read When` table), never merged into this branch (`L06-Evals`, which
  uses the newer `AGENTS.md` + per-package `@AGENTS.md`-import split). All 3
  files exist on `upstream/evals-example` and could be copied over, but their
  content is stale (references "L01", pre-dates `docs/agent-prompts/README.md`
  and `reviewer-core/README.md`, which already document the same
  prompt-assembly/pipeline material in richer, current form) — copying them
  in would duplicate and could contradict the current docs. Re-pointed the
  cases at real, already-current files instead (`server/README.md`,
  `docs/agent-prompts/README.md`, `INSIGHTS.md`).

- **Update (same day, later session):** `WorkflowCase` now HAS a per-case
  `cwd` override (both `trace` and `contrast` kinds, `src/dsl/case.ts`) —
  the "not present as of 2026-08-20" caveat in the entry above is stale as
  of the same day. Passing `cwd: join(REPO_ROOT, "client")` (etc.) makes
  `workflowTask` load that package's nested `CLAUDE.md`/`AGENTS.md` too.
- **A `contrast` case comparing "nested package `AGENTS.md` loaded" (cwd =
  package dir) vs "only root `AGENTS.md` loaded" (cwd = `REPO_ROOT`) is
  flaky whenever ANY root-reachable doc chain leads to the same target
  file — even with `tools: ["Read"]` (no Grep/Glob) and a prompt that
  doesn't name the target path.** Tried this for `client/AGENTS.md` →
  `src/vendor/ui/README.md`. Attempt 1 (default tools): control had
  Grep/Glob and just found the doc by searching the full repo tree — cwd
  doesn't sandbox tool access, see the entry above. Attempt 2 (`tools:
  ["Read"]`, de-leaked prompt): control STILL reached the file, because
  root `AGENTS.md`'s own docs index lists `client/README.md`, and
  `client/README.md` itself links to `src/vendor/ui/README.md` — a
  legitimate two-hop Read chain from root alone, no search needed. There
  was no clean negative left to assert. Converted to a plain `trace` (only
  proves the positive: cwd inside the package makes the model follow that
  package's `AGENTS.md` routing) instead of forcing a contrast that keeps
  failing for reasons outside the case's control. Before designing this
  kind of cwd-based contrast, grep the doc graph from root for the target
  filename first — if anything already links to it, a contrast here isn't
  viable, only a one-sided `trace`.
- **A `trace` prompt meant to force a specific file Read must ask for
  something documented ONLY in that file — not something the parent
  `AGENTS.md`'s own inline body text already answers.** A case asked "is
  importing directly from an internal package file OK?" with cwd inside
  `client/` — answerable straight from `client/AGENTS.md`'s own
  "Non-default conventions" bullet (states the barrel-import rule inline),
  so the model answered correctly with **zero** Read tool calls, never
  opening `src/vendor/ui/README.md`. Rewording to ask specifically for
  content client/AGENTS.md's Docs-index bullet promises but doesn't itself
  contain ("design-system layers and theming structure") reliably produced
  the Read call. When picking a routing target, prefer a doc whose content
  isn't already summarized in the referring AGENTS.md's own prose.

## Tool & Library Notes

- **`Result.filesRead` entries are OS-native paths — `\`-separated on
  Windows — so a plain `.includes()` against a `/`-separated case-authored
  substring silently fails even when the model read exactly the right
  file.** `runClaude` (`src/runtime/run-claude.ts`) pushes the Read tool's
  `file_path`/`path` input verbatim into `filesRead`; on Windows that's
  `D:\htdocs\devDigest\docs\agent-prompts\README.md`, not
  `docs/agent-prompts/README.md`. `src/dsl/case.ts`'s `trace`/`contrast`
  assertions and `activated()`'s SKILL.md fallback all originally compared
  with `f.includes(file)` — this failed 4 of 6 `workflow` cases in one run
  even though the trace log showed the correct file was read. Fixed by a
  `readIncludes()` helper in `case.ts` that normalizes both sides
  (`.replace(/\\/g, "/")`) before comparing. Any new path-substring
  assertion added to the eval harness must go through `readIncludes()`, not
  raw `.includes()`.
- **`expectSubagents` (dispatch/trace cases) has visible run-to-run
  variance — the same prompt against the same repo state doesn't reliably
  produce the exact expected subagent name every time.** In one session,
  the "API-route task... pulls the architecture-reviewer" `trace` case
  passed 3 times, then failed once (dispatched *something* — `subagents`
  had 1 entry — but not the literal string `"architecture-reviewer"`), then
  passed again immediately on a solo re-run with no code change in
  between. Don't treat a single failing run of a dispatch-asserting case as
  a real regression — re-run it alone before investigating further.

- **Merging N single-doc routing checks into ONE `trace` session works reliably when each check is
  a separate numbered ask pinned to its own doc — unlike the earlier "two docs, one vague topic"
  case that was dropped for flakiness.** The failure mode that broke the old pipeline+gotchas combo
  was the model satisficing on the FIRST relevant doc it found for one fuzzy topic. Six *separate*,
  explicitly numbered questions (`review-workflow.cases.ts`'s merged root-routing case) each map to
  exactly one doc, so there's no single doc that could satisfy more than one item — nothing to
  satisfice across. Passed first try both times it ran, reading all 5 expected docs (6 turns, 5 tool
  calls one run; picked up 3 more ADR docs on its own the other run, still hit all 5 required ones).
  Reduced the suite from 12 live sessions to 7 without losing any check.

- **Passing an `agents: Record<string, AgentDefinition>` override to the SDK's `query()` `Options`
  does NOT take precedence over the same-named agent auto-discovered from `settingSources:
  ["project"]`.** Tried this to force `model: "inherit"` on every real `.claude/agents/*.md`
  subagent under `EVAL_BACKEND=openrouter` (so a subagent's own `model: sonnet` frontmatter
  wouldn't try to resolve through the OpenRouter/LiteLLM proxy). Shipped it, re-ran CI, the proxy
  log still showed the exact same `openrouter/claude-sonnet-5 is not a valid model ID` error —
  the on-disk frontmatter won. Reverted the (non-functional) `agents` plumbing entirely and fixed
  it at the source instead: removed `model: sonnet` from the subagent's own frontmatter (omitting
  `model` already means "inherit the parent's model" per the SDK's own docs). If a subagent needs
  to run under a backend the parent session doesn't natively support, don't try to override it
  from the harness side — fix the agent file.
- **OpenRouter carries no Claude Sonnet listing at all** (verified via a live fetch of
  `https://openrouter.ai/api/v1/models` on 2026-08-20 — zero ids containing "sonnet"). A subagent
  whose frontmatter pins `model: sonnet`/any Sonnet alias will always fail when dispatched through
  an OpenRouter-routed session, independent of any proxy config — there is nothing to route to.
- **`pnpm vitest run "agents/${{ matrix.X }}"` in a GitHub Actions matrix is a substring match, not
  a directory-exact match** — `"agents/architecture-reviewer"` also matches
  `agents/architecture-reviewer-lite/...`, silently running (and grading) the wrong sibling's tests
  inside what should be an isolated matrix leg. A job that looked like it was failing on
  `architecture-reviewer`'s own findings was actually failing on `architecture-reviewer-lite`'s
  (genuinely flakier, by design) results bleeding in. Fix: always anchor the pattern with a
  trailing slash (`"agents/${{ matrix.agent }}/"`) whenever a matrix value could be a prefix of a
  sibling directory name.
- **`skillContent()` only inlined `SKILL.md` + `references/*.md` — silently missing every skill
  that documents itself under `rules/` instead** (`dependency-checker`, `onion-architecture`,
  `fastify-best-practices` all use `rules/`; no repo convention picks one folder name over the
  other). A `kind: "quality"` case for one of these skills was judging SKILL.md's prose alone,
  missing the bulk of the skill's actual instructions — e.g. `dependency-checker`'s report-format
  rule (which mandates the Mermaid `flowchart` keyword) lives in `rules/report-format.md` and was
  invisible to the eval, so the model reasonably improvised the equally-valid-but-ungrounded
  `graph TD` alias and failed a grounding check that was really testing whether the skill's own
  instructions were even being read. Fixed by inlining both `references/` and `rules/`.

## Session Notes

- 2026-08-20: Fixed `pnpm eval:workflow` (was failing 4/6 — 3 cases pointed
  at nonexistent stale-fixture docs, all 4 file-assertion cases tripped by
  the Windows path-separator bug above). Re-pointed the 3 broken `trace`
  cases at real current docs, added a `contrast` (control/treatment) case
  for `docs/agent-prompts/README.md` routing, fixed `case.ts`'s path
  matching. All 6 cases pass.
- 2026-08-20 (later session): Added a per-case `cwd` override to
  `WorkflowCase` (`trace`/`contrast`) and 5 more cases — 3 root
  `docs/features/*.md` routing checks, 1 do-not-touch redirect check
  (grounding on response text, new optional `grounding` field on `trace`),
  and 1 `trace` proving `client/AGENTS.md` loads and routes correctly when
  cwd is inside `client/`. 11/11 cases pass (individually confirmed; one
  full-suite run flaked on the pre-existing dispatch case, see the
  `expectSubagents` variance entry above).
- 2026-08-20 (same day, third pass): Merged 6 single-topic root `trace`
  cases (pipeline, gotchas, PR Brief, Intent Layer, Project Context,
  do-not-touch) into 1 combined session — see the "Merging N single-doc
  routing checks" entry above. Suite is now 6 `test()` cases / 7 live
  sessions (down from 11 `test()` / 12 sessions), full run green on the
  first try.
- 2026-08-20 (CI wiring session): Turned the newly-added
  `.github/workflows/evals.yml` blocking (temporarily) specifically to
  force real failures to the surface, root-caused all four, fixed each,
  then reverted the gate back to report-only (the documented/graded
  design — see AGENTS.md's routing table) once the underlying bugs were
  confirmed fixed, not just hidden by non-blocking status. Root causes,
  none of which were "the model is just bad": (1) `skillContent()`
  silently dropped `rules/`-folder skills — see Tool & Library Notes;
  (2) `architecture-reviewer.md` cited docs that don't exist
  (`server/docs/architecture.md`, `reviewer-core/docs/pipeline.md`) —
  re-pointed every RULE's Source at real files
  (`.claude/skills/onion-architecture/rules/*`, `server/AGENTS.md`,
  `reviewer-core/AGENTS.md`); (3) `.claude/agents/architecture-reviewer-lite.md`
  never existed on disk despite `evals/agents/architecture-reviewer-lite/`
  referencing it — every run failed instantly with "agent not found",
  not a real model-quality signal; (4) `architecture-reviewer.md`'s
  `model: sonnet` frontmatter broke subagent dispatch under
  `EVAL_BACKEND=openrouter` — see the two OpenRouter/model-override
  entries in Tool & Library Notes. Also fixed a CI-only bug found while
  debugging (4): the `skills`/`agents` matrix jobs' vitest pattern
  matched sibling directories by substring, contaminating one matrix
  leg's grade with an unrelated one's results.
