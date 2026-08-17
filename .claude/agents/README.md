# `.claude/agents/` — subagent map

This directory holds the **Claude Code mirror** of DevDigest's cross-tool
agent personas. The canonical, tool-agnostic definitions live in
[`agents/<name>.md`](../../agents/) at the repo root; each file here is a
manual mirror (frontmatter + prompt) of that source, per the
[AGENTS.md](../../AGENTS.md#cross-cutting-conventions) convention — edit
`agents/<name>.md` first, then mirror the change here (and into
`.codex/agents/`, `.cursor/agents/`) by hand.

This README is a map of the set, not a substitute for reading each agent's
full file — it does not duplicate their instructions.

## Agents at a glance

| Agent | Responsibility | Tools (permissions) | Model | Reads (input) | Produces (output) |
|---|---|---|---|---|---|
| [spec-creator](spec-creator.md) | Turns a feature/task request into a **Spec** grounded in real code, existing specs, and any design assets provided. Runs before `implementation-planner`. `specs/` is otherwise human-authored, read-only to every other agent here — this is the sole exception. Invokes `security` (grounds NFRs/Untrusted inputs) and `mermaid-diagram` (optional cross-module diagrams). Never writes code, never produces a Development Plan. | `Read`, `Grep`, `Glob`, `Bash` (read-only inspection only), `AskUserQuestion`, `Skill`, `Write` (scoped to `specs/` only — a module subfolder for a single-module Spec, top-level for a cross-module one, no `Edit`) | `opus` | Task/feature request; design assets; root + package `AGENTS.md`/`INSIGHTS.md`; existing `specs/*.md`; `docs/adr/**`/`docs/features/**` | Spec draft (chat) **and** a saved copy at `specs/SPEC-NN-<slug>.md` |
| [implementation-planner](implementation-planner.md) | Turns an already-scoped feature/task request into a structured **Development Plan** grounded in real files, `AGENTS.md`/`INSIGHTS.md` constraints, do-not-touch paths, and the skills catalog; reads existing `specs/*.md` as requirements input and surfaces its own `Recommendations`, but never authors or edits a spec. Confirms multi-agent vs. single-agent execution mode before saving. Never writes code, never executes the plan. | `Read`, `Grep`, `Glob`, `Bash` (read-only inspection only), `AskUserQuestion`, `Write` (scoped to `docs/plans/` only — no `Edit`, never `specs/`) | `opus` | Task/feature request; `specs/*.md` if one exists; root + package `AGENTS.md`/`INSIGHTS.md`; target module code; `.claude/skills/*/SKILL.md` catalog | Development Plan (chat report, incl. `Recommendations` + execution mode) **and** a saved copy at `docs/plans/<slug>.md` |
| [implementer](implementer.md) | Executes an already-approved Development Plan across `client/`/`server/`: applies each work item's named skills, edits code, runs tests, self-checks the diff. No architecture/security review. | `Read`, `Edit`, `Write`, `Bash`, `Grep`, `Glob`, `Skill` — `permissionMode: default` (see caveat below) | `sonnet` | A Development Plan, pasted or as a `docs/plans/*.md` path; package `INSIGHTS.md` | Code changes; test results; updated `INSIGHTS.md`; Implementation Report (chat) |
| [researcher](researcher.md) | Read-only investigation in two modes — **repository research** (this codebase) or **external research** (web/docs) — for questions that need investigating before anyone changes code. | `Read`, `Grep`, `Glob`, `Bash` (read-only), `WebFetch`, `WebSearch`, `AskUserQuestion` — no `Edit`/`Write` | `sonnet` | A concrete, checkable question; scope (repo/external/both) | Repository Research or External Research report (chat only — never a file) |
| [test-writer](test-writer.md) | Writes tests for code `implementer` already shipped, as a separate post-implementation pass with a two-phase oracle-independence rule. `e2e/` is out of scope. | `Read`, `Grep`, `Glob`, `Bash`, `Edit`, `Write` (test files only, by instruction), `Skill` | `sonnet` | A Development Plan + spec (if any) + the shipped code (wiring facts only) | Test files; Test Report (chat) |
| [plan-verifier](plan-verifier.md) *(includes `architecture-reviewer` — merged 2026-08-07, see below)* | Two-phase gate: **Phase 1 — spec compliance** (per-item traceability of a Development Plan against observable evidence, binary verdicts, non-hedgeable final verdict); **Phase 2 — architecture review** (semantic judgment layer above `pnpm arch:check`). | `Read`, `Grep`, `Glob`, `Bash`, `Skill`, `AskUserQuestion` — **no `Edit`/`Write`** | `opus` | A Development Plan + the resulting code state; `implementer`'s and `test-writer`'s reports (for what to check only, never as evidence); `server/.dependency-cruiser.cjs`; `pnpm arch:check` output | Plan Verification report (Phase 1: `VERDICT: PASS`/`FAIL`/`PASS WITH REQUIRED FIXES`; Phase 2: Architecture Review findings) (chat only) |
| [doc-writer](doc-writer.md) | Documents already-implemented, already-verified features per a 7-branch Diátaxis placement rule. Runs last in the chain. | `Read`, `Grep`, `Glob`, `Bash`, `Write`, `Edit` (`docs/**` only, by instruction), `Skill`, `AskUserQuestion` | `sonnet` | Shipped code/diff; Development Plan; `plan-verifier`'s Phase 2 findings | New file(s) under `docs/**`; Documentation Report (chat) |

Notes on the table:
- "Permissions" = the `tools:` frontmatter allowlist; none of the six can
  do anything outside that list (e.g. `researcher` cannot invoke skills or
  edit files even to "just fix" something it finds).
- `implementer`'s `permissionMode: default` asks for manual per-write
  confirmation, but per Claude Code's sub-agent/permission-mode docs this is
  overridden if the invoking session already runs under `acceptEdits`,
  `bypassPermissions`, or `auto` — it's a default, not an unbypassable floor
  (see [Sources](#sources-for-implementation-planners-and-implementers-rules) below).
- `implementation-planner` and `researcher` both gate on vagueness: an
  underspecified request triggers `AskUserQuestion` before any
  planning/searching starts. `implementation-planner` also gates on
  requirements gaps and always asks once to confirm execution mode.
- `researcher` and `plan-verifier` are **tool-allowlist-enforced
  read-only** agents — neither has `Edit`/`Write` in its `tools:` list.
  `plan-verifier` needs `Bash` to actually run the plan's `Test plan`
  commands rather than assume they pass, and needs `Skill` to invoke
  `onion-architecture` in Phase 2.

## Handoff chain

```
user/orchestrator → spec-creator → Spec (specs/SPEC-NN-<slug>.md)
                                        │            (optional — see below)
                                        ▼
                          implementation-planner → Development Plan (docs/plans/<slug>.md)
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

- `spec-creator` is the only **optional** step at the front of the chain —
  `implementation-planner` accepts a bare task description directly, same
  as before `spec-creator` existed. Run it first for non-trivial features;
  skip it for small, already-obvious changes.
- `researcher` remains outside the chain — it's invoked independently,
  whenever a step in any workflow needs an investigated answer rather than
  a plan or a code change.
- A `FAIL` from `plan-verifier`'s Phase 1, or a `Critical` from its Phase 2,
  loops back to **`implementer`** against the *same* plan — not to
  `implementation-planner` — unless the finding is that the plan itself was
  wrong, which is the only case that re-enters at `implementation-planner`.
- A non-empty `Behavior mismatches found` from `test-writer`, once
  `plan-verifier` confirms it with its own evidence, becomes a Phase 1
  `NOT MET` row and follows the same loop-back to `implementer` — it never
  reaches `doc-writer` unaddressed.
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
between them. One agent invocation now does both passes instead of two,
avoiding a second cold start and a second independent fetch of the diff.

The merge preserves both source personas' non-negotiable properties by
running them as strictly ordered phases inside one report, not as blended
judgment:

- **Phase 1 runs to completion first**, ending in a written, non-hedgeable
  `VERDICT:` line, before Phase 2 opens. This is the same "no holistic
  judgment before the per-item table is complete" rule the original
  `plan-verifier` had — now it also means "no architecture opinion leaks
  into the compliance verdict."
- **Phase 2 starts with the deterministic-tool-first workflow** (`pnpm
  arch:check`) exactly as the original `architecture-reviewer` did, and
  reports only what that tool can't express.
- The two phases keep **separate report sections** — never merged into a
  single table or a single score, so a reader (or `doc-writer`) can still
  cite each phase's output independently.

## Sources for spec-creator's, implementation-planner's, and implementer's rules

These personas' hard constraints are grounded in specific repo conventions
and external docs, not invented rules. Listed so a change to any of these
sources is a signal to revisit the corresponding agent file.

**spec-creator** (`spec-creator.md`):
- User-provided EARS reference (Mavin/Wilkinson/Harwood/Novak, IEEE RE'09)
  and Spec template — source of the acceptance-criteria patterns and the
  exact section order this agent writes.
- `docs/adr/NNNN-title.md` naming convention — source of the
  `specs/SPEC-NN-<slug>.md` filename shape.
- `.claude/skills/security/SKILL.md` — source of the OWASP-grounding step
  before finalizing `Non-functional requirements`/`Untrusted inputs`.
- `.claude/skills/mermaid-diagram/SKILL.md` — source of the optional
  cross-module interaction diagram, same skill `doc-writer` already uses.
- `implementation-planner.md`'s "Not responsible for: specifications" and
  `doc-writer.md`'s `specs/` read-only boundary — the human-authored-only
  rule this agent is the sole exception to.
- Canonical [`agents/spec-creator.md`](../../agents/spec-creator.md) — this
  file is a manual mirror of that source.

**implementation-planner** (`implementation-planner.md`):
- Root [`AGENTS.md`](../../AGENTS.md) — "read `INSIGHTS.md` before starting
  work" convention; per-package do-not-touch lists; the
  not-a-monorepo/package layout the plan's `Scope` section reflects.
- Root and per-package `INSIGHTS.md` files — treated as high-confidence
  constraints per `AGENTS.md`'s own instruction, not suggestions.
- `.claude/skills/*/SKILL.md` catalog — source for the "Skill catalog by
  domain" lookup table and the requirement that every relevant work item
  name an exact skill.
- `spec-creator.md` — source of the `specs/SPEC-NN-<slug>.md` shape this
  agent reads as requirements input; source of the "read specs as
  requirements input, never author one" boundary.
- Canonical [`agents/implementation-planner.md`](../../agents/implementation-planner.md)
  — this file is a manual mirror of that source; divergence between them is
  a bug in the mirror, not an intentional difference.

**implementer** (`implementer.md`):
- Root [`AGENTS.md`](../../AGENTS.md) — same do-not-touch lists as
  `implementation-planner`; the "update `INSIGHTS.md` before ending a
  session" convention that drives the End-of-session step.
- `engineering-insights` skill — defines what's worth recording in
  `INSIGHTS.md` and the append-only format `implementer` follows there.
- The `implementation-planner` agent's Development Plan report format —
  `implementer`'s entire input contract (work items, `Applicable skills`,
  `Definition of done`) is defined by `implementation-planner`'s own report
  structure, not chosen independently.
- Claude Code docs on sub-agents and permission modes
  (`code.claude.com/docs/en/sub-agents`, `.../permission-modes`) — cited
  directly in the file's mirror comment as the basis for the
  `permissionMode: default`-can-be-overridden caveat above.
- Canonical [`agents/implementer.md`](../../agents/implementer.md) — mirror
  source, same convention as `implementation-planner`.

**plan-verifier** (`plan-verifier.md`) — sources for both phases:

Phase 1 (spec compliance):
- Galtea, LLM-as-a-judge prompts & best practices
- arXiv 2507.11662, 2604.06996, 2606.09863 — verifier over-validation,
  self-preference bias, false success rates
- obra/superpowers — spec-compliance verification as distinct PRIOR gate
- TestRail — Requirements Traceability Matrix pattern

Phase 2 (architecture review):
- Claude Code Code Review docs — severity labels, `file:line` citations
- Google engineering practices — reviewer comments and severity labeling
- Jeffrey Palermo — Onion Architecture
- Next.js — Data Access Layer guidance
- ArchUnitTS, madge, dependency-cruiser — deterministic architecture checks
- `server/.dependency-cruiser.cjs` — PRE_EXISTING_MODULES exemption and
  filename-scoped rules

`researcher` has no equivalent sources section: its rules (two modes,
no-write, cite-everything) are self-contained conventions for a research
agent, not derived from a repo-specific policy document.
