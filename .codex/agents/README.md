# `.codex/agents/` — subagent map (OpenAI Codex mirror)

This directory holds the **Codex CLI/cloud mirror** of DevDigest's
cross-tool agent personas. The canonical, tool-agnostic definitions live in
[`agents/<name>.md`](../../agents/) at the repo root; each `.toml` file here
is a manual mirror of that source, per the
[AGENTS.md](../../AGENTS.md#cross-cutting-conventions) manual-mirror
convention — edit `agents/<name>.md` first, then mirror the change here
(and into `.claude/agents/`, `.cursor/agents/`) by hand.

Seven agents mirrored into three tools (`spec-creator`,
`implementation-planner`, `implementer`, `researcher`, `test-writer`,
`plan-verifier`, `doc-writer`); see
[`agents/README.md`](../../agents/README.md) for the tool-agnostic
responsibilities and the handoff chain between them. This file only covers
what's **Codex-specific**: how each agent's constraints map onto Codex's
actual enforcement levers, which differ from Claude Code's tool allowlist.

## Codex's enforcement model, in one paragraph

Codex has no per-tool or per-path permission list — its only lever is
`sandbox_mode` (`read-only` / `workspace-write` / `danger-full-access`),
plus a separate, **session-level** `approval_policy` that isn't settable
per agent at all. That's why the constraint wording in each `.toml` differs
from `.claude/agents/*.md` even though the underlying rule (e.g.
"implementation-planner may only write its own plan file") is identical —
Codex enforces less
mechanically, so more of the boundary rests on `developer_instructions`
being followed rather than on the sandbox blocking it.

## Agents at a glance

| Agent | Responsibility | `sandbox_mode` | Reasoning tier | Reads (input) | Produces (output) |
|---|---|---|---|---|---|
| [spec-creator](spec-creator.toml) | Same as canonical: Spec (SDD) from a feature/task request, grounded in real code, existing specs, and design assets. Runs before `implementation-planner`. `specs/` is otherwise human-authored, read-only elsewhere — this is the sole exception. Applies `security`/`mermaid-diagram` by reading their `SKILL.md` directly (Codex has no native skills mechanism). Never writes code. | `workspace-write` — set one notch looser than "read-only" purely to allow the one file it must write; the `specs/`-only scope (module subfolder for a single-module Spec, top-level for a cross-module one) is instruction-enforced, not sandboxed. | `model_reasoning_effort = "high"` | Task request; design assets; root + package `AGENTS.md`/`INSIGHTS.md`; existing `specs/*.md`; `docs/adr/**`/`docs/features/**` | Spec draft (chat) + `specs/SPEC-NN-<slug>.md` |
| [implementation-planner](implementation-planner.toml) | Same as canonical: Development Plan from an already-scoped task request, grounded in `AGENTS.md`/`INSIGHTS.md`/skills catalog; reads `specs/*.md` as requirements input and surfaces `Recommendations`, never authors a spec; confirms execution mode before saving. Never edits code. | `workspace-write` — binary lever, so it's set one notch looser than "read-only" purely to allow the one file it must write; the `docs/plans/`-only scope (and the `specs/`-never boundary) is instruction-enforced, not sandboxed. | `model_reasoning_effort = "high"` | Task request; `specs/*.md` if one exists; root + package `AGENTS.md`/`INSIGHTS.md`; skills catalog | Development Plan (chat, incl. `Recommendations` + execution mode) + `docs/plans/<slug>.md` |
| [implementer](implementer.toml) | Same as canonical: executes an approved plan, edits code, runs tests. | `workspace-write` — real edit access inside the checkout, no wider. | Not pinned in this file — comment recommends "mid-to-high" if your Codex config supports per-agent tiers | A Development Plan (pasted or `docs/plans/*.md` path); package `INSIGHTS.md` | Code changes; test results; updated `INSIGHTS.md`; Implementation Report (chat) |
| [researcher](researcher.toml) | Same as canonical: repo or external investigation, no writes. | `read-only` — the one mirror where Codex's sandbox alone enforces the "no writes" rule at the OS level, stronger than a tool allowlist. | Not pinned — inherits the calling profile/session's model; comment suggests mid-tier is enough for research/synthesis | A concrete question; scope (repo/external/both) | Repository Research or External Research report (chat only) |
| [test-writer](test-writer.toml) | Same as canonical: writes tests for already-shipped code as an independent pass, two-phase oracle-independence rule, `e2e/` out of scope. | `workspace-write` — scoped to test files only by instruction | `model_reasoning_effort` not pinned — comment recommends mid-to-high | A Development Plan + spec (if any); implementation for wiring facts only | Test files; Test Report (chat) |
| [plan-verifier](plan-verifier.toml) *(includes `architecture-reviewer` — merged 2026-08-07)* | Two-phase gate (spec compliance + architecture review): Phase 1 verifies per-item plan compliance against observable evidence with non-hedgeable verdicts; Phase 2 is the semantic judgment layer above `pnpm arch:check`, read-only. | `workspace-write` — same looks-looser-than-it-is situation `implementation-planner` already documents (test-runner caches, not source edits) | `model_reasoning_effort = "high"`, prefer a different model family than the implementer where possible | A Development Plan + code state; `implementer`'s and `test-writer`'s reports (for what to check only, never as evidence); `server/.dependency-cruiser.cjs` | Plan Verification report (Phase 1 traceability table + VERDICT, then Phase 2 Architecture Review findings table) — chat only |
| [doc-writer](doc-writer.toml) | Same as canonical: documents already-verified features via the 7-branch placement rule, runs last. | `workspace-write` — scoped to `docs/**` only by instruction | Not pinned — comment recommends mid-tier | Shipped code/diff; Development Plan; `plan-verifier`'s Phase 2 findings | New file(s) under `docs/**`; Documentation Report (chat) |

Notes specific to this mirror:
- `plan-verifier` is `workspace-write` to allow test-runner caches even
  though the agent never edits source — instruction-only "no source edits",
  the same looks-looser-than-it-is situation `implementation-planner.toml`
  already documents. `researcher` is the only agent here where
  `sandbox_mode = "read-only"` enforces "no writes" at the OS level.
- **No `approval_policy` field exists in per-agent TOML** (confirmed against
  Codex's subagents docs as of 2026-08-06). Per-write confirmation for
  `implementer` is a session/global Codex setting (`approval_policy =
  "on-request"` or `"untrusted"`), not something this file can set — see
  the comment at the top of [`implementer.toml`](implementer.toml). This is
  the Codex analogue of `.claude/agents/implementer.md`'s
  `permissionMode: default` caveat: same underlying gap (a per-agent
  approval hint that can't force manual confirmation), different platform.
- `implementation-planner`'s `sandbox_mode = "workspace-write"` looks like
  it grants more than Claude's equivalent (`Write` scoped to `docs/plans/`
  only) — it doesn't. Codex has no path-scoped write permission, so the
  same `docs/plans/`-only boundary (and the `specs/`-never boundary) is
  enforced by `developer_instructions` alone here, not by the platform.
  Don't read the wider sandbox mode as a wider actual scope.
- `researcher`'s `sandbox_mode = "read-only"` is the one place this mirror
  is *more* strictly enforced than Claude Code's tool allowlist — a
  sandbox-level block instead of a missing-tool block.

## Sources for spec-creator's, implementation-planner's, and implementer's rules

- User-provided EARS reference and Spec template — source of
  `spec-creator.toml`'s acceptance-criteria patterns and section order.
  `docs/adr/NNNN-title.md` naming convention — source of the
  `specs/SPEC-NN-<slug>.md` filename shape.
- `.claude/skills/security/SKILL.md` and
  `.claude/skills/mermaid-diagram/SKILL.md` — source of `spec-creator.toml`'s
  OWASP-grounding step and optional cross-module diagram; read by path
  since Codex has no native skills mechanism.
- Root [`AGENTS.md`](../../AGENTS.md) and per-package `INSIGHTS.md` — same
  do-not-touch lists, INSIGHTS.md-read/update conventions, and skills
  catalog reference as every other mirror.
- `.claude/skills/*/SKILL.md` catalog — source of the "Skill catalog by
  domain" table in both `implementation-planner.toml` and
  `implementer.toml`. Codex has no native skills mechanism; the table
  exists purely so a human reading the plan can point Codex at the right
  skill file manually.
- `spec-creator.toml` — source of the `specs/SPEC-NN-<slug>.md` shape
  `implementation-planner.toml` reads as requirements input; source of the
  "read specs as requirements input, never author one" boundary.
- `engineering-insights` skill — defines the `INSIGHTS.md` update
  `implementation-planner` flags and `implementer` performs at session end.
- Codex's own subagents documentation — cited directly in
  [`implementer.toml`](implementer.toml)'s comment as the basis for "no
  `approval_policy` field exists in per-agent TOML (verified 2026-08-06)"
  and for the fact that a subagent inherits the parent turn's permission
  mode rather than setting its own.
- Canonical [`agents/spec-creator.md`](../../agents/spec-creator.md) /
  [`agents/implementation-planner.md`](../../agents/implementation-planner.md)
  / [`agents/implementer.md`](../../agents/implementer.md) — mirror source;
  divergence between the `.toml` here and the canonical `.md` is a mirror
  bug, not an intentional difference.

`researcher.toml` has no equivalent sources section, same reasoning as its
`.claude/agents/` counterpart: its rules are self-contained research-agent
conventions, not derived from a repo-specific policy document.
