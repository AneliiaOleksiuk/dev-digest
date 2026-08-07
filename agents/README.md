# `agents/` — canonical subagent definitions

This directory is the **source of truth** for DevDigest's cross-tool agent
personas. Each `agents/<name>.md` file is tool-agnostic prose; it gets
manually mirrored, by hand, into three tool-native formats — no sync script,
same convention this repo uses for `@devdigest/shared`
([AGENTS.md](../AGENTS.md#cross-cutting-conventions)):

- [`.claude/agents/<name>.md`](../.claude/agents/) — Claude Code subagent
  (`tools:` allowlist, `permissionMode`)
- [`.codex/agents/<name>.toml`](../.codex/agents/) — OpenAI Codex CLI/cloud
  subagent (`sandbox_mode`, `model_reasoning_effort`)
- [`.cursor/agents/<name>.md`](../.cursor/agents/) — Cursor Subagent
  (`readonly`, `model`)

**Workflow: edit here first, then mirror by hand into all three.** Each
tool's directory has its own README documenting what's specific to that
tool's enforcement model — this file documents the shared role, not
tool-specific mechanics. Divergence between a mirror and its canonical
file here is a bug in the mirror, not an intentional difference.

Mirroring is a **mechanical reformatting step** — the canonical file already
states the exact per-tool tool-list/sandbox/model settings (see each
persona's "Capabilities" table), so the mirror pass is transcription, not
design. Do it with a fast/cheap model pass or a template, not the same
reasoning tier used to edit the canonical file — see "Context handoff and
mirroring cost" below.

Not to be confused with [`docs/agent-prompts/`](../docs/agent-prompts/) —
those are system prompts for DevDigest's own in-app PR-review agents (a
product feature this repo builds). `agents/` is tooling for people
*developing* DevDigest, never something the app itself serves.

(GitHub Copilot custom agents, formerly mirrored into `.github/agents/`, were
dropped from this set on 2026-08-07 — see root
[`INSIGHTS.md`](../INSIGHTS.md) for why.)

## Agents at a glance

| Agent | Responsibility | Capabilities (tool-agnostic) | Model | Reads (input) | Produces (output) |
|---|---|---|---|---|---|
| [planner](planner.md) | Turns a feature/task request into a structured **Development Plan** grounded in real files, `AGENTS.md`/`INSIGHTS.md` constraints, do-not-touch paths, and the skills catalog. Never writes code, never executes the plan. | Read/search the repo, read-only git history; write exactly one file per run (`docs/plans/<slug>.md`) — no other path, ever; ask a clarifying question before starting if the task is vague | Opus (or the calling tool's strongest reasoning tier) — planning quality is the bottleneck this agent protects | Task/feature request; root + package `AGENTS.md`/`INSIGHTS.md`; target module code; `.claude/skills/*/SKILL.md` catalog | Development Plan (chat) + saved copy at `docs/plans/<slug>.md` |
| [implementer](implementer.md) | Executes an already-approved Development Plan across `client/`/`server/`: applies each work item's specified skills, edits code, runs tests, self-checks the diff. No architecture/security review. | Read/edit/write repo files; run shell commands (installs, tests, typecheck, build — never destructive git ops without confirmation); invoke skills per work item, not preloaded | Sonnet (or the calling tool's mid-to-high tier) — correctness matters more than raw cost here | A Development Plan (pasted inline by the orchestrator when available, else a `docs/plans/*.md` path); package `INSIGHTS.md` (inlined by the orchestrator when available, else read directly) | Code changes; test results; updated `INSIGHTS.md`; Implementation Report (chat) |
| [researcher](researcher.md) | Read-only investigation in two modes — **repository research** or **external research** — for questions that need investigating before anyone changes code. | Read/search the repo and git history; fetch/search external web sources; ask a clarifying question before starting if the task is vague; never writes/edits/deletes anything | Mid-tier reasoning model (Sonnet or equivalent) — research/synthesis, not a task needing the largest model | A concrete, checkable question; scope (repo/external/both) | Repository Research or External Research report (chat only — never a file) |
| [test-writer](test-writer.md) | Writes tests for code `implementer` already shipped, as a separate post-implementation pass with a two-phase oracle-independence rule (derive expected behavior from the plan/spec/contract before reading implementation). `e2e/` is out of scope. | Read/search the repo, the plan, specs, contracts; write test files only (`server/test/**`, colocated `client` `*.test.tsx`, `reviewer-core/test/**`); run test commands; invoke `react-testing-library`/`react-best-practices`/`fastify-best-practices`/`drizzle-orm-patterns`/`typescript-expert`/`zod` per test class | Sonnet (`inherit` in Cursor) | A Development Plan + spec (if any), inlined by the orchestrator when available; the shipped code (for wiring facts only) | Test files; Test Report (chat) |
| [plan-verifier](plan-verifier.md) | Two-phase gate that runs after `test-writer`: **Phase 1 — spec compliance**, per-item traceability of the Development Plan against observable evidence (`git diff`, command output), binary verdicts, non-hedgeable final verdict (`PASS`/`FAIL`/`PASS WITH REQUIRED FIXES`), locked before Phase 2 starts. **Phase 2 — architecture review**, the semantic judgment layer above the deterministic `depcruise` check (`server/arch:check`) — reports only import-legal boundary violations `depcruise` can't express, never re-reporting what the tool already caught. | Read/search/`git diff`/`git show`; command execution for tests, typecheck, and `pnpm arch:check` (no `Edit`/`Write` in any mirror) | Opus, prefer a different model family than the implementer where possible | A Development Plan + the resulting code state, diff inlined by the orchestrator when available; `implementer`'s report (for what to check only, never as evidence); `server/.dependency-cruiser.cjs` | Plan Verification report (`VERDICT: PASS`/`FAIL`/`PASS WITH REQUIRED FIXES`) immediately followed, in the same response, by an Architecture Review section (findings table) — chat only |
| [doc-writer](doc-writer.md) | Documents already-implemented, already-verified features per a 7-branch Diátaxis placement rule. Runs last in the chain. | Read/search the repo, the plan, `implementer`'s report `Deviations`; write scoped to `docs/**` only; invokes `mermaid-diagram` | Sonnet | Shipped code/diff (inlined by the orchestrator when available); Development Plan; `plan-verifier`'s Phase 2 findings | New file(s) under `docs/**`; Documentation Report (chat) |

## Handoff chain

```
user/orchestrator → planner → Development Plan (docs/plans/<slug>.md)
                                        │
                                        ▼
                                  implementer → code + INSIGHTS.md
                                        │
                                        ▼
                                  test-writer → tests, written as an
                                        │        independent pass (oracle
                                        │        derived from the plan, not
                                        │        from implementer's code)
                                        ▼
                                 plan-verifier → Phase 1: per-item
                                        │        traceability + PASS / FAIL /
                                        │        PASS WITH REQUIRED FIXES
                                        │        (spec gate; verdict is
                                        │        locked before Phase 2 opens)
                                        │
                                        │        Phase 2: architecture
                                        │        review — boundary findings
                                        │        above `depcruise`, read-only
                                        │
                                        │  (security review — still a separate
                                        │   agent, not in this set)
                                        ▼
                                    doc-writer → docs/** only
```

- `researcher` remains outside the chain — it's invoked independently,
  whenever a step in any workflow needs an investigated answer rather than
  a plan or a code change.
- A `FAIL` from `plan-verifier`'s Phase 1, or a `Critical` from its Phase 2,
  loops back to **`implementer`** against the *same* plan — not to
  `planner` — unless the finding is that the plan itself was wrong, which
  is the only case that re-enters at `planner`.
- Phase 1's verdict must be written and locked **before** Phase 2 begins —
  merging the two phases into one agent must not let architecture findings
  bleed into or soften the spec-compliance verdict. See "Why plan-verifier
  and architecture-reviewer merged into one agent" below.
- `doc-writer` runs **last** so it documents what actually shipped and
  passed, per Google's "update docs in the same change" rule applied to
  the change as a whole rather than to a half-verified intermediate state.

## Why plan-verifier and architecture-reviewer merged into one agent

Originally two separate agents. Merged 2026-08-07 to cut the token cost of a
sequential, non-conflicting pair: both were read-only, both Opus, both ran
back-to-back over the same diff/plan with no write-capability tension
between them (unlike, say, `implementer`/`test-writer`, which stay separate
specifically because one writes the code the other tests — see "What was
deliberately NOT merged" below). One agent invocation now does both passes
instead of two, avoiding a second cold start, a second independent fetch of
the diff, and a second read of the plan.

The merge preserves both source personas' non-negotiable properties by
running them as strictly ordered phases inside one report, not as blended
judgment:

- **Phase 1 runs to completion first**, ending in a written, non-hedgeable
  `VERDICT:` line, before Phase 2 opens. This is the same "no holistic
  judgment before the per-item table is complete" rule the original
  `plan-verifier` had — now it also means "no architecture opinion leaks
  into the compliance verdict."
- **Phase 2 starts with the deterministic-tool-first workflow**
  (`pnpm arch:check`) exactly as the original `architecture-reviewer` did,
  and reports only what that tool can't express.
- The two phases keep **separate report sections** (Traceability table +
  `VERDICT:`, then Architecture Review findings table) — never merged into
  a single table or a single score, so a reader (or `doc-writer`) can still
  cite each phase's output independently.

## What was deliberately NOT merged

- **`implementer` + `test-writer`** stay separate agents, not phases of one.
  The reason is the opposite of why `plan-verifier`/`architecture-reviewer`
  merged: here the whole value is that the test oracle is derived
  independently of the code that was just written (see `test-writer.md`
  §Oracle independence). Collapsing them into one pass would let the same
  reasoning trace write the code and then write tests that just confirm
  what it already did — the exact failure mode the split exists to prevent.
  Sequential-and-cheap is not sufficient reason to merge; sequential-and-
  non-conflicting is.

## Context handoff convention (why "inline it" appears throughout)

Every downstream agent (`implementer` onward) can receive its large,
repo-derived inputs — the Development Plan, package `INSIGHTS.md` excerpts,
and especially the diff — **inlined directly in the prompt by whoever
invokes it**, instead of being told to go fetch them itself via `git diff`/
`Read`. This is a delivery-mechanism change only, not a trust change:

- Each agent still forms its **own independent judgment** from that inlined
  content — `implementer` still reviews `INSIGHTS.md` itself rather than
  trusting `planner`'s summary of it; `plan-verifier` still never treats
  `implementer`'s narrative claims as evidence, inlined diff or not.
- Every agent still works standalone if invoked directly (e.g. a human
  pastes a `docs/plans/*.md` path into Cursor with no orchestrator) — inline
  content is preferred when available, self-fetching is the fallback, never
  a hard requirement removed.
- The payoff is avoiding the same diff, the same `AGENTS.md`, and the same
  `INSIGHTS.md` being independently re-fetched and re-tokenized by up to
  four separate agent invocations in one chain (`implementer` → `test-writer`
  → `plan-verifier` → `doc-writer`) when one fetch, done once by the
  orchestrator, covers all of them.

## Why the write/approval boundaries read differently per mirror

None of the three mirrored tools support scoping a write permission to a
single path natively: Claude Code's `tools:` list, Codex's `sandbox_mode`,
and Cursor's `readonly` are all repo-wide read-only/read-write toggles, not
per-path grants. So `planner`'s "`docs/plans/` only" boundary, and
`implementer`'s "manual approval expected," are **instructional** boundaries
here — enforced by the agent following them, not by a technical sandbox in
any of the three tools. Each tool directory's own README
(`.claude/agents/README.md`, `.codex/agents/README.md`,
`.cursor/agents/README.md`) documents exactly how far that specific tool's
platform enforcement goes and where it falls back to instruction alone.

The two boundary shapes the four newer personas add:
- **Read-only but needs command execution** (`plan-verifier`, now covering
  both its original spec-compliance phase and the former
  `architecture-reviewer`'s phase) — no `Edit`/`Write` in any mirror, but
  `Bash`/`runCommands` (and, on Codex/Cursor, a `workspace-write`/
  `readonly: false` sandbox that is technically write-capable for
  test-runner/lint caches only) because "did it pass" and "does
  `pnpm arch:check` report anything" must be observed by actually running
  commands in this session, not assumed.
- **Path-scoped write** (`test-writer` → test files only; `doc-writer` →
  `docs/**` only) — same shape as `planner`'s `docs/plans/`-only scope:
  instructional in all three mirrors, since none of them support scoping a
  write permission to a path natively (see Risks #2 in the plan that
  introduced these personas for one documented exception worth
  re-verifying: Claude Code's `Edit(docs/**)` permission syntax).

## Sources for each persona's rules

Every persona's hard constraints are grounded in specific repo conventions
or external sources, not invented rules. A change to any of these sources
is a signal to revisit the corresponding file here (and then all three
mirrors).

**planner** (`planner.md`):
- Root [`AGENTS.md`](../AGENTS.md) — "read `INSIGHTS.md` before starting
  work" convention; per-package do-not-touch lists; the package layout the
  plan's `Scope` section reflects.
- Root and per-package `INSIGHTS.md` files — treated as high-confidence
  constraints per `AGENTS.md`'s own instruction, not suggestions.
- `.claude/skills/*/SKILL.md` catalog — source for the "Skill catalog by
  domain" lookup table and the requirement that every relevant work item
  name an exact skill. (The catalog itself lives under `.claude/`, but it's
  shared across all three tools — none of the others have a native skills
  mechanism of their own.)

**implementer** (`implementer.md`):
- Root [`AGENTS.md`](../AGENTS.md) — same do-not-touch lists as `planner`;
  the "update `INSIGHTS.md` before ending a session" convention that drives
  the End-of-session step.
- `engineering-insights` skill — defines what's worth recording in
  `INSIGHTS.md` and the append-only format `implementer` follows there.
- `planner`'s own Development Plan report format — `implementer`'s entire
  input contract (work items, `Applicable skills`, `Definition of done`) is
  defined by `planner.md`, not chosen independently.
- Each tool's own docs on subagent permission models — cited per-mirror,
  not here, since the caveat is different in each tool (see each mirror
  directory's README).

`researcher.md` has no equivalent sources section: its rules (two modes,
no-write, cite-everything) are self-contained conventions for a research
agent, not derived from a repo-specific policy document.

**test-writer** (`test-writer.md`):
- Anthropic — Best practices for Claude Code (Writer/Reviewer split: "have
  one Claude write tests, then another write code to pass them") —
  https://code.claude.com/docs/en/best-practices
- Arthur Hertweck — "the oracle must be independent of the generator";
  tautological tests arise when one model infers the spec from its own
  implementation — https://arthurhertweck.dev/writing/tautological-testing
- Testing Library — query priority (`getByRole` first, `getByTestId` last
  resort); tests should "resemble how users interact with your code" —
  https://testing-library.com/docs/queries/about/
- Kent C. Dodds — avoid testing implementation details —
  https://kentcdodds.com/blog/testing-implementation-details
- Kent C. Dodds — Testing Trophy; favor integration tests, minimize
  mocking, coverage has diminishing returns past ~70% —
  https://kentcdodds.com/blog/write-tests
- Fastify — official testing guide, `fastify.inject()` for route/
  integration tests without a real socket —
  https://fastify.dev/docs/latest/Guides/Testing/
- Vitest — mocking guide; clear/restore mocks in `beforeEach`/`afterEach`
  to avoid cross-test leakage — https://vitest.dev/guide/mocking
- Peter Phonix — test automation guardrails: "the AI should fix the code,
  not the tests"; never weaken or delete a passing test to make a suite
  green — https://medium.com/@peterphonix/test-automation-guardrails-0e1a18ee064f
- `TESTING.md` and per-package `AGENTS.md`/`INSIGHTS.md` — the repo's own
  typological-not-exhaustive philosophy, `*.it.test.ts` naming, the two
  typed-out server split commands, and the pnpm no-TTY fallback.

**plan-verifier** (`plan-verifier.md`) — sources for both phases:

Phase 1 (spec compliance):
- Galtea — LLM-as-a-judge prompts, templates, rubrics: enumerate every
  requirement with evidence *first*, then assign a binary verdict per
  item; never a holistic score first —
  https://galtea.ai/blog/llm-as-a-judge-prompts-templates-rubrics-and-best-practices
- arXiv 2507.11662 — LLM verifiers systematically over-validate flawed
  work; true-negative detection as low as 50%, resistant to
  chain-of-thought alone — https://arxiv.org/html/2507.11662v3
- arXiv 2604.06996 — self-preference/confirmation bias: a judge from the
  same model family as the implementer rates that work more favorably —
  https://arxiv.org/pdf/2604.06996
- arXiv 2606.09863 — "false success": agents misreport partial work as
  complete at high rates; the fix is checking claims against observable
  state (tests, execution, diffs), not the narrative —
  https://arxiv.org/html/2606.09863
- obra/superpowers — spec-compliance verification as a distinct PRIOR gate
  to code-quality review; per-item evidence required; "looks good overall"
  explicitly unacceptable; non-hedgeable final verdict —
  https://deepwiki.com/obra/superpowers/6.8-code-review-process
- TestRail — Requirements Traceability Matrix (requirement → evidence →
  verdict) — https://www.testrail.com/blog/requirements-traceability-matrix/

Phase 2 (architecture review):
- Claude Code — Code Review: behavior claims need a `file:line` citation
  in the source rather than an inference from naming; Severity +
  File:Line + Issue table; cap low-value "Nit" comments —
  https://code.claude.com/docs/en/code-review
- Google — engineering practices, reviewer comments: explain *why*, use
  explicit severity labels, avoid vague prose —
  https://google.github.io/eng-practices/review/reviewer/comments.html
- Jeffrey Palermo — The Onion Architecture, Part 1: the domain layer must
  not depend on any outer layer —
  https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/
- Next.js — Data Access Layer guidance so routes don't bypass the service
  layer — https://nextjs.org/blog/security-nextjs-server-components-actions
- ArchUnitTS — layer rules and `.should().haveNoCycles()` as test
  assertions (deterministic tools own binary/structural rules) —
  https://github.com/LukasNiessen/ArchUnitTS
- madge — circular dependency detection —
  https://www.npmjs.com/package/madge
- Xebia — taking frontend architecture seriously with dependency-cruiser
  (import-graph rules) —
  https://xebia.com/blog/taking-frontend-architecture-serious-with-dependency-cruiser/
- `server/.dependency-cruiser.cjs` and `.claude/skills/onion-architecture/`
  — source of the `PRE_EXISTING_MODULES` exemption and the four
  filename-scoped rules Phase 2 starts from.

**doc-writer** (`doc-writer.md`):
- Diátaxis — tutorials / how-to / reference / explanation as the
  categorization for "which section does this belong in" —
  https://diataxis.fr/ and https://diataxis.fr/reference/
- arc42 — Building Block View (static structure) vs Runtime View
  (behavior/scenarios), used here as diagram-type-per-section —
  https://arc42.org/overview/
- ADR GitHub organization — ADRs live at `docs/adr/NNNN-title.md`, one
  decision per file, sequential numbering —
  https://adr.github.io/gadr/docs/adr/
- C4 model — "you don't need to use all 4 levels of diagram; only those
  that add value" — https://c4model.com/diagrams
- Google — documentation best practices: update docs in the same change as
  the implementation; stale docs are worse than none —
  https://google.github.io/styleguide/docguide/best_practices.html
- Claude Code — permissions and sub-agents: path-scoped write restriction
  via `Edit(docs/**)`; `Write(docs/**)` is *not* honored for path scoping
  — https://code.claude.com/docs/en/permissions and
  https://code.claude.com/docs/en/sub-agents (unverified against current
  docs as of this writing — see the write/approval-boundaries note above;
  do not treat as active platform enforcement without checking first)
