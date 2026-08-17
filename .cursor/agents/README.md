# `.cursor/agents/` — subagent map (Cursor mirror)

This directory holds the **Cursor Subagent mirror** of DevDigest's
cross-tool agent personas. The canonical, tool-agnostic definitions live in
[`agents/<name>.md`](../../agents/) at the repo root; each file here is a
manual mirror of that source, per the
[AGENTS.md](../../AGENTS.md#cross-cutting-conventions) manual-mirror
convention — edit `agents/<name>.md` first, then mirror the change here
(and into `.claude/agents/`, `.codex/agents/`) by hand.

Cursor also auto-discovers `.claude/agents/` for Claude compatibility, but
this repo mirrors explicitly into `.cursor/agents/` too, for consistency
with the other two tools.

Seven agents total in this mirror (same roster, same roles as the canonical
set in [`agents/`](../../agents/)); see [`.claude/agents/README.md`](../../.claude/agents/README.md)
for the tool-agnostic responsibilities and the handoff chain between them.
This file only covers what's **Cursor-specific**: how each agent's
constraints map onto Cursor's native `readonly`/`model` frontmatter, which
differs from Claude Code's tool allowlist and `permissionMode`.

## Cursor's enforcement model, in one paragraph

Cursor's subagent frontmatter is small: `name`, `description`, `model`,
`readonly`, `is_background` — documented as the full field list (verified
2026-08-06). `readonly` is binary and, unlike Claude's per-tool allowlist,
is the *only* write-blocking lever: `true` blocks all file edits and
state-changing shell commands at the platform level; `false` grants real
write access with no further scoping. There's no per-agent approval/
confirmation field — that lives in Cursor's global Auto-Run/YOLO setting,
outside every agent file.

## Agents at a glance

| Agent | Responsibility | `readonly` | `model` | Reads (input) | Produces (output) |
|---|---|---|---|---|---|
| [spec-creator](spec-creator.md) | Same as canonical: Spec (SDD) from a feature/task request, grounded in real code, existing specs, and design assets. Runs before `implementation-planner`. `specs/` is otherwise human-authored, read-only elsewhere — this is the sole exception. Applies `security`/`mermaid-diagram` by reading their `SKILL.md` directly (Cursor has no native skills mechanism). Never writes code. | `false` — binary lever, set to allow the one file it must write; the `specs/`-only scope (module subfolder for a single-module Spec, top-level for a cross-module one) is instruction-enforced, not platform-enforced. | `claude-opus-5[effort=high]` — pinned, since Spec quality is this agent's bottleneck | Task request; design assets; root + package `AGENTS.md`/`INSIGHTS.md`; existing `specs/*.md`; `docs/adr/**`/`docs/features/**` | Spec draft (chat) + `specs/SPEC-NN-<slug>.md` |
| [implementation-planner](implementation-planner.md) | Same as canonical: Development Plan from an already-scoped task request, grounded in `AGENTS.md`/`INSIGHTS.md`/skills catalog; reads `specs/*.md` as requirements input and surfaces `Recommendations`, never authors a spec; confirms execution mode before saving. Never edits code. | `false` — binary lever, so it's set to allow the one file it must write; the `docs/plans/`-only scope (and the `specs/`-never boundary) is instruction-enforced, not platform-enforced. | `claude-opus-5[effort=high]` — pinned, since planning quality is this agent's bottleneck | Task request; `specs/*.md` if one exists; root + package `AGENTS.md`/`INSIGHTS.md`; skills catalog | Development Plan (chat, incl. `Recommendations` + execution mode) + `docs/plans/<slug>.md` |
| [implementer](implementer.md) | Same as canonical: executes an approved plan, edits code, runs tests. | `false` — real write access, unlike implementation-planner/researcher's effective read-only-by-instruction/platform | `inherit` | A Development Plan (pasted or `docs/plans/*.md` path); package `INSIGHTS.md` | Code changes; test results; updated `INSIGHTS.md`; Implementation Report (chat) |
| [researcher](researcher.md) | Same as canonical: repo or external investigation, no writes. | `true` — the one mirror where Cursor's platform enforces "no writes" directly, no instruction reliance needed | `inherit` | A concrete question; scope (repo/external/both) | Repository Research or External Research report (chat only) |
| [test-writer](test-writer.md) | Same as canonical: writes tests for already-shipped code as an independent pass, two-phase oracle-independence rule, `e2e/` out of scope. | `false` — real write access, scoped by instruction to test files only | `inherit` | A Development Plan + spec (if any); implementation for wiring facts only | Test files; Test Report (chat) |
| [plan-verifier](plan-verifier.md) *(includes `architecture-reviewer` — merged 2026-08-07)* | Same as canonical: two-phase gate (Phase 1 — per-item plan-compliance verdicts against observable evidence; Phase 2 — architecture review, the semantic judgment layer above `pnpm arch:check`). Non-hedgeable final verdict. | `false` — needed for command execution (test/typecheck/`pnpm arch:check`); "never edits source" is instruction-enforced here, looser than Claude for this persona | `claude-opus-5[effort=high]` — pinned, and prefer a different model family than the implementer where possible | A Development Plan + code state; `implementer`'s and `test-writer`'s reports (for what to check only, never as evidence) | Plan Verification report with Phase 1 verdict table + Phase 2 Architecture Review findings (chat only) |
| [doc-writer](doc-writer.md) | Same as canonical: documents already-verified features via the 7-branch placement rule, runs last. | `false` — real write access, scoped by instruction to `docs/**` only | `inherit` | Shipped code/diff; Development Plan; `plan-verifier`'s Phase 2 findings | New file(s) under `docs/**`; Documentation Report (chat) |

Notes specific to this mirror:
- `researcher` is the only agent here where `readonly: true` is
  **platform-enforced**, not instruction-only. `plan-verifier` is
  `readonly: false` purely to allow command execution (tests/typecheck/
  `pnpm arch:check`) — the one mirror where this persona is looser than in
  Claude Code, same shape `implementation-planner.md`'s comment already
  documents for its own scoped write.
- **`model` pinning has a documented caveat**: Cursor's forum reports that
  a pinned model can be silently ignored "under certain conditions"
  (blocked by org policy, requires Max Mode, not on your plan) — the
  subagent then silently falls back to the parent's model instead of
  erroring. A fix is said to land in Cursor v2.5. See the comment at the
  top of [`implementation-planner.md`](implementation-planner.md). Don't
  assume `opus` actually ran for `implementation-planner` without checking.
- `researcher.md` is the only mirror where `readonly: true` is
  **platform-enforced** rather than instruction-enforced — the direct Cursor
  equivalent of Claude Code's "no Write/Edit tools at all" and Codex's
  `sandbox_mode = "read-only"`.
- `implementer.md`'s "manual approval expected" note is purely operator
  guidance, same gap as every other mirror: no per-agent approval field
  exists in Cursor's frontmatter (only `readonly`, confirmed 2026-08-06),
  so disabling Auto-Run/YOLO before invoking it is on the person invoking
  it, not something this file can force.

## Sources for spec-creator's, implementation-planner's, and implementer's rules

- User-provided EARS reference and Spec template — source of
  `spec-creator.md`'s acceptance-criteria patterns and section order.
  `docs/adr/NNNN-title.md` naming convention — source of the
  `specs/SPEC-NN-<slug>.md` filename shape.
- `.claude/skills/security/SKILL.md` and
  `.claude/skills/mermaid-diagram/SKILL.md` — source of `spec-creator.md`'s
  OWASP-grounding step and optional cross-module diagram; read by path
  since Cursor has no native skills mechanism.
- Root [`AGENTS.md`](../../AGENTS.md) and per-package `INSIGHTS.md` — same
  do-not-touch lists, INSIGHTS.md-read/update conventions, and skills
  catalog reference as every other mirror. Also: why plan-verifier and
  architecture-reviewer merged into one agent (see
  [`agents/README.md`](../../agents/README.md#why-plan-verifier-and-architecture-reviewer-merged-into-one-agent)).
- `.claude/skills/*/SKILL.md` catalog — source of the "Skill catalog by
  domain" table in both `implementation-planner.md` and `implementer.md`.
  Cursor has no native skills mechanism; the table exists so a human
  reading the plan can point Cursor at the right skill file manually.
- `spec-creator.md` — source of the `specs/SPEC-NN-<slug>.md` shape
  `implementation-planner.md` reads as requirements input; source of the
  "read specs as requirements input, never author one" boundary.
- `engineering-insights` skill — defines the `INSIGHTS.md` update
  `implementation-planner` flags and `implementer` performs at session end.
- `cursor.com/docs/subagents` — cited directly in
  [`implementation-planner.md`](implementation-planner.md)'s comment as the
  source for the `model: claude-opus-5[effort=high]` bracketed-options
  syntax, and for the documented full frontmatter field list (`name`,
  `description`, `model`, `readonly`, `is_background`) cited in
  [`implementer.md`](implementer.md)'s comment.
- Cursor's community forum — cited in
  [`implementation-planner.md`](implementation-planner.md)'s comment as the
  source for the "model field can be silently ignored" caveat and its
  reported v2.5 fix.
- Canonical [`agents/spec-creator.md`](../../agents/spec-creator.md) /
  [`agents/implementation-planner.md`](../../agents/implementation-planner.md)
  / [`agents/implementer.md`](../../agents/implementer.md) — mirror source;
  divergence between the file here and the canonical `.md` is a mirror bug,
  not an intentional difference.

`researcher.md` has no equivalent sources section, same reasoning as its
`.claude/agents/` counterpart: its rules are self-contained research-agent
conventions, not derived from a repo-specific policy document.
