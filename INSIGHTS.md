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

_(to be filled in)_

## Codebase Patterns

- **Why no monorepo tooling (pnpm workspaces / turborepo):** this is a course
  starter — each package is meant to be readable and runnable in isolation
  without a build orchestrator to learn first. Cross-package types are shared
  via tsconfig path aliases instead.
- **Why `@devdigest/shared` is hand-copied instead of a real package:** same
  reason — no workspace, no publish step. The trade-off is real drift risk
  (`server/src/vendor/shared/adapters.ts` still has a stale `apps/api/` path
  comment from whatever repo it was copied from) with no tooling to catch it.

## Tool & Library Notes

- **`pnpm <script>` can abort with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`**
  in this Windows/PowerShell tool environment (no TTY attached) whenever pnpm
  detects any drift between the lockfile and `node_modules` and wants to
  reinstall — it refuses to proceed non-interactively instead of just
  reinstalling. `corepack pnpm <script>` hits the same wall. Workaround: call
  the already-installed binary directly, e.g.
  `.\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.json` and
  `.\node_modules\.bin\vitest.cmd run` from the package dir — skips pnpm's
  install-check entirely and still gives a real typecheck/test result.
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
  (planner → implementer → test-writer → plan-verifier → doc-writer),
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
  4. **Shortened static boilerplate** in `planner`/`implementer`'s report
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

## Open Questions

- **`reviewer-core/` is on npm while everything else is on pnpm:** unclear
  from the code — most likely an artifact of how the package was bootstrapped
  separately. Worth normalizing to pnpm if it ever causes friction; until then
  it's a known, harmless inconsistency, not a bug to "fix" reflexively.
