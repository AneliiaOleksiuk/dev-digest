# Development Plan: add `test-writer`, `architecture-reviewer`, `plan-verifier`, `doc-writer` subagent personas

## Objective

Add four new cross-tool subagent personas to the existing `agents/` system —
`test-writer`, `architecture-reviewer`, `plan-verifier`, `doc-writer` — each as
a canonical `agents/<name>.md` plus its four hand-mirrored tool-native copies,
and update `agents/README.md` (and the four mirror READMEs) so the "Agents at a
glance" table and the Handoff chain cover them. These four are exactly what the
current handoff diagram's `(architecture/security review — separate agents, out
of scope)` parenthetical was deferring; this plan closes that gap and defines
the post-implementation review chain concretely.

## Scope

- Packages/modules touched: **none of `server` / `client` / `reviewer-core` /
  `e2e`**. This is entirely repo-tooling: `agents/`, `.claude/agents/`,
  `.codex/agents/`, `.github/agents/`, `.cursor/agents/`, plus root `AGENTS.md`.
- Explicitly out of scope:
  - Any file under `server/src/**`, `client/src/**`, `reviewer-core/src/**`,
    `e2e/**` — no product code changes at all.
  - `.claude/skills/**` — no new skill is created; the new personas reference
    the existing catalog, they don't extend it.
  - `docs/agent-prompts/**` — those are the in-app PR-review agents' system
    prompts (a product feature), not this system. See `agents/README.md:24-27`.
  - Creating actual documentation content in the new `docs/` subsections —
    this plan defines `doc-writer`'s placement rule, it does not write docs.
  - Security-reviewer persona — still deferred, still a separate agent (see
    Handoff chain below, which keeps the placeholder).

## Constraints

- **Manual-mirror convention (no sync script).** Root `AGENTS.md` §Cross-cutting
  conventions: "Cross-tool agent personas live in `agents/<name>.md`
  (canonical) and are manually mirrored". `agents/README.md:18-22`: "edit here
  first, then mirror by hand into all four … Divergence between a mirror and
  its canonical file here is a bug in the mirror." Every new persona therefore
  costs 5 files, not 1.
- **Existing canonical-file structure must be matched exactly.** Read
  `agents/planner.md`, `agents/implementer.md`, `agents/researcher.md` before
  authoring. The shared skeleton is: title `# Agent: <name>` → canonical/mirror
  preamble → `Mirrored into:` list of the four exact paths → (optional)
  "Not to be confused with `docs/agent-prompts/`" note → `## Role` →
  `## Capabilities (map to each tool's native mechanism in its own file)` →
  `## Hard constraints` → `## Before starting: …` → domain sections →
  `## Report format — <Report name>` (fenced block) → `## Quality bar` →
  `## Model`.
- **Mirror frontmatter shapes are fixed per tool** (verified against the
  existing `researcher` mirrors):
  - `.claude/agents/<name>.md` — YAML `name`, `description` (block scalar,
    includes a "use PROACTIVELY when…" trigger sentence), `tools`, `model`;
    then an HTML comment `<!-- Mirrored from agents/<name>.md — edit that file
    first… -->`.
  - `.codex/agents/<name>.toml` — leading `#` mirror comment, then `name`,
    `description`, `sandbox_mode`, optional model comment, then
    `developer_instructions = """…"""`.
  - `.github/agents/<name>.agent.md` — YAML `description` (single-quoted one
    line), `tools: [...]` array from VS Code's fixed named set, a `# model:`
    comment (never a pinned model id — see `.github/agents/README.md:57-60`).
  - `.cursor/agents/<name>.md` — YAML `name`, `description`, `model`,
    `readonly`; mirror comment noting what Cursor enforces.
- **Per-tool enforcement reality** (`agents/README.md:54-66`): none of the four
  tools scope a write permission to a path via the agent file, so every
  "may only write X" boundary in these personas is *instructional*, except
  Codex `sandbox_mode = "read-only"` and Cursor `readonly: true`, which are
  platform-enforced. Each new persona's mirror must repeat the tool-appropriate
  caveat the way `planner`/`implementer` already do. (One documented exception
  to re-verify: see Risks #2.)
- **Skills catalog is shared across all four tools** even though it physically
  lives under `.claude/skills/` — the other three have no native skills
  mechanism, so their mirrors instruct reading the skill file by path
  (`.codex/agents/README.md:61-64`, `.cursor/agents/README.md:64-67`).
- **Root `INSIGHTS.md` §Tool & Library Notes** — `pnpm <script>` can abort with
  `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` in this environment; the
  workaround is calling `.\node_modules\.bin\vitest.cmd` / `tsc.cmd` directly.
  Both `test-writer` and `plan-verifier` must carry this as a documented
  fallback, since both run suites.
- **Root `INSIGHTS.md` §Tool & Library Notes** — Docker is not auto-started
  here, so `server` integration tests (`*.it.test.ts`) may be unrunnable.
  `plan-verifier`'s verdict format must handle "evidence unavailable" without
  degrading into a hedge (see WI3).
- **`TESTING.md` §Conventions** — integration tests must be `*.it.test.ts`;
  `server/package.json` is `skip-worktree`, so **no new `test:unit` /
  `test:integration` scripts may be added there**. `test-writer` must be told
  this explicitly.
- **`TESTING.md` §Philosophy** — "typological, not exhaustive… If a test
  wouldn't catch a class of regression we care about, we don't write it." This
  is the repo's own anti-coverage-chasing rule and must be `test-writer`'s
  headline constraint, ahead of any external testing advice.
- **`client/AGENTS.md` §Non-default conventions** — feature logic lives in
  colocated `_components/<Name>/` folders "each with its own `*.test.tsx`".
  That fixes `test-writer`'s client file placement; confirmed by real files
  such as `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.test.tsx`.
- **`client/AGENTS.md` §Gotchas** — `client/src/test/smoke.test.tsx` mounts
  `/showcase` and fails CI on any vendored-component breakage; `test-writer`
  must not "fix" that suite by weakening it.
- **`server/AGENTS.md` §Commands** — the unit/integration split is *not* in
  `package.json` and must be typed out: `pnpm exec vitest run --exclude
  '**/*.it.test.ts'` and `pnpm exec vitest run .it.test`.
- **Boundary enforcement already exists.** `server/package.json` has
  `"arch:check": "depcruise --config .dependency-cruiser.cjs src"` and
  `server/.dependency-cruiser.cjs` defines four `error`-severity rules
  (`no-service-to-db`, `no-service-to-adapter-impl`,
  `no-routes-to-db-or-adapter`, `no-helpers-to-io`). Critically, all four are
  gated by `PRE_EXISTING_MODULES` (`server/.dependency-cruiser.cjs:10-11`),
  which exempts `agents|polling|pulls|repo-intel|repos|reviews|settings|
  workspace|_shared` — so the deterministic tool checks **new modules only**.
  That exemption, plus everything a 4-rule import graph can't express, is
  precisely `architecture-reviewer`'s semantic territory.
- **Do-not-touch paths** (root `AGENTS.md`): `*/src/vendor/**`,
  `*/src/db/migrations/**`. Not touched by this plan, but each new persona's
  Hard constraints must restate them where relevant (`test-writer` must not
  add tests that edit vendored files; `doc-writer` never writes source at all).

## Design decisions this plan fixes (implementer must not re-derive these)

### Handoff chain — updated

Replace the diagram in `agents/README.md:39-48` (and the identical copy in
`.claude/agents/README.md:36-45`) with:

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
                                 plan-verifier → per-item traceability +
                                        │        PASS / FAIL / PASS WITH
                                        │        REQUIRED FIXES (spec gate,
                                        │        runs before quality review)
                                        ▼
                          architecture-reviewer → boundary findings, read-only
                                        │
                                        │  (security review — still a separate
                                        │   agent, not in this set)
                                        ▼
                                    doc-writer → docs/** only
```

Plus this prose, to be added directly under the diagram:

- `researcher` remains outside the chain (unchanged wording).
- A `FAIL` from `plan-verifier`, or a `Critical` from `architecture-reviewer`,
  loops back to **`implementer`** against the *same* plan — not to `planner` —
  unless the finding is that the plan itself was wrong, which is the only case
  that re-enters at `planner`.
- `doc-writer` runs **last** so it documents what actually shipped and passed,
  per Google's "update docs in the same change" rule applied to the change as
  a whole rather than to a half-verified intermediate state.

### Sequencing decision: `test-writer` is a separate post-implementation pass, not a step inside `implementer`

**Recommendation: separate pass.** Justification:

- The load-bearing property is oracle independence — "the oracle must be
  independent of the generator." If `implementer` writes the tests for code it
  just wrote, the same reasoning pass infers the spec from its own
  implementation, and the tests assert what the code does rather than what the
  plan required. Anthropic's own Claude Code guidance recommends exactly this
  split (one Claude writes tests, another writes the code).
- This repo's plan format makes the split cheap and precise: every work item
  already carries a `Definition of done`, so `test-writer` has a written
  oracle that predates the implementation and does not have to reverse-engineer
  intent from the diff.
- Practical concession (must be written into `agents/test-writer.md` verbatim
  as a two-phase rule, because a purist "never look at the code" agent can't
  produce a compiling test file): **Phase 1 — read the Development Plan, the
  spec (`specs/*.md`) if one exists, and the public contract (Zod schemas,
  route definitions, component props) and enumerate the test cases from those
  alone, before opening the implementation. Phase 2 — read implementation
  files only for wiring facts (import paths, exported names, testids, route
  paths, fixture helpers), never to decide what the expected behavior is.** If
  Phase 2 reveals behavior that contradicts the Phase-1 expectation, the test
  keeps the Phase-1 expectation and the mismatch is reported as a finding —
  it is not silently reconciled.
- Consequence for the existing persona: `agents/implementer.md` must be
  amended so the two don't contradict each other (WI5).

### `architecture-reviewer` — concrete read-only capability list

Fully read-only in **all four** mirrors — no `Edit`, no `Write`, in any of
them. This is a strictly tighter scope than `planner` (which has the
`docs/plans/` exception) and than `implementer`.

| Mirror | Concrete setting | Enforcement |
|---|---|---|
| `.claude/agents/architecture-reviewer.md` | `tools: Read, Grep, Glob, Bash, Skill, AskUserQuestion` — **no `Edit`, no `Write`**; `model: opus` | Tool-allowlist enforced (missing-tool block), same class as `researcher` |
| `.codex/agents/architecture-reviewer.toml` | `sandbox_mode = "read-only"` | **Platform-enforced at the OS level** — same as `researcher.toml` |
| `.github/agents/architecture-reviewer.agent.md` | `tools: ['search', 'codebase', 'usages', 'runCommands']` — **no `editFiles`** | Tool-list enforced |
| `.cursor/agents/architecture-reviewer.md` | `readonly: true`, `model: claude-opus-5[effort=high]` | **Platform-enforced** by Cursor |

`Skill` appears only in the Claude mirror (it is a read-only capability there);
the other three mirrors instruct reading
`.claude/skills/onion-architecture/SKILL.md` and
`.claude/skills/onion-architecture/rules/enforcement.md` by path instead,
matching how every existing mirror handles the no-native-skills gap.

Two caveats that must be written into the mirrors:
- Cursor's `readonly: true` blocks state-changing shell commands; if it also
  blocks `depcruise`, the documented fallback is to ask the operator to run
  `cd server && pnpm arch:check` and paste the output, rather than routing
  around `readonly`.
- Codex `read-only` sandbox: `depcruise` only reads, so it should run, but the
  same paste-the-output fallback applies if the sandbox refuses.

### `plan-verifier` — non-hedgeable verdict format

Per-item verdicts are binary. Evidence column is filled **before** the verdict
column, per item, and evidence must be observable state — a `file:line`, a
`git diff` hunk, or literal command output — never a quotation from
`implementer`'s own Implementation Report.

Allowed per-item verdicts, and nothing else:
- `MET` — evidence shown satisfies the item as written.
- `NOT MET` — includes anything partially done; the missing piece must be
  named. "Partially met" is not an available verdict.
- `NOT VERIFIED` — permitted **only** with a stated concrete blocker (e.g.
  "Docker unavailable, `*.it.test.ts` lane cannot run"). Any `NOT VERIFIED`
  row makes `PASS` unavailable as a final verdict.

Final line of the report must be exactly one of, with no adjacent hedging:
- `VERDICT: PASS`
- `VERDICT: FAIL`
- `VERDICT: PASS WITH REQUIRED FIXES`

Banned outputs, listed explicitly in the persona file: "looks good overall",
"mostly complete", "LGTM", any numeric score, any holistic judgment written
before the per-item table is complete, and any restatement of general code
quality advice in place of a per-item check.

### `doc-writer` — placement rule and write scope

Write scope: **`docs/**` only.** Never `server/`, `client/`, `reviewer-core/`,
`e2e/`, never `specs/`, never `docs/plans/` (planner-owned), never
`docs/agent-prompts/` unless the task is literally about the in-app reviewer
prompts.

Placement decision rule (Diátaxis mapped onto this repo's real layout; the
first matching branch wins):

1. **Not yet implemented / scope agreement** → `specs/<feature>.md`. This is
   *out of `doc-writer`'s write scope* — `specs/` is pre-implementation scope
   owned by humans and `planner`. `doc-writer` reads specs as source material
   and never edits them.
2. **Explains an implemented feature: what it does, why, how the pieces fit**
   (Diátaxis *explanation* + *reference* hybrid) → `docs/features/<feature>.md`.
   This is the default for "describe an implemented feature", i.e. most of
   `doc-writer`'s work.
3. **Task-oriented "how do I do X"** (Diátaxis *how-to*) →
   `docs/how-to/<task>.md`.
4. **Stable lookup surface: API/contract/config tables** (Diátaxis *reference*)
   → `docs/reference/<subject>.md`.
5. **One architectural decision + its rationale and alternatives** →
   `docs/adr/NNNN-<kebab-title>.md`, sequential 4-digit numbering, one decision
   per file.
6. **Tutorials** (Diátaxis *tutorial*) → out of scope; this repo is a course
   starter and `README.md` + the course material own that quadrant.
7. **Map-level, package-local fact** (belongs in `server/README.md`,
   `client/AGENTS.md`, etc.) → outside the write scope. `doc-writer` proposes
   the exact edit text in chat, flagged `Requires human/implementer to apply`.

Additional rules for the persona file:
- Never create a **fifth** top-level `docs/` subsection without asking first —
  the four above (`features`, `how-to`, `reference`, `adr`) plus the existing
  `agent-prompts` and `plans` are the whole taxonomy.
- Every new doc file requires an entry in root `AGENTS.md` §Docs index. That
  file is outside the write scope, so `doc-writer` must output the proposed
  index line as a diff in chat under `Requires human/implementer to apply` —
  a new doc with no index entry is an incomplete deliverable.
- Diagrams: use the `mermaid-diagram` skill. Diagram type by purpose, per
  arc42's Building Block View vs Runtime View split — flowchart/class for
  static structure, sequence for runtime flows, ER for data model. Per C4's
  "only the levels that add value", default to **one** diagram per document,
  the shallowest that answers the document's question; more than one needs a
  reason stated in the doc.
- Diagram syntax must be valid: per `client/AGENTS.md` §Gotchas, a bad Mermaid
  string renders as an injected error SVG instead of throwing, so a broken
  diagram fails silently rather than loudly.
- Grounding: every factual claim traces to a real `path/file.ts` (line number
  where useful). Source of truth is the shipped code and the diff — read
  `implementer`'s Implementation Report `Deviations` section, because the plan
  may not describe what actually shipped. Never document intended-but-unbuilt
  behavior.

### Model tiers

| Persona | Model | Why |
|---|---|---|
| `test-writer` | Sonnet (`inherit` in Cursor, not pinned in Copilot) | Real multi-file writes against a fixed oracle — same profile as `implementer` |
| `architecture-reviewer` | Opus | Its entire value is the judgment layer above `depcruise`; a weaker tier degrades straight into generic advice |
| `plan-verifier` | Opus, and **prefer a different model/family than the one that implemented**, where the tool allows | Verifier over-validation is the documented failure mode; self-preference bias is worst when judge and author share a family |
| `doc-writer` | Sonnet | Synthesis and writing against already-verified code |

## Work items

1. **Author `agents/test-writer.md` (canonical).**
   - Files/modules: `d:\htdocs\devDigest\agents\test-writer.md` (new)
   - Applicable skills: none for authoring (no catalog skill governs persona
     files). The persona's own *content* must name, as the skills it applies:
     `react-testing-library` and `react-best-practices` for `client/**`;
     `fastify-best-practices` for `server/**` route/plugin tests;
     `drizzle-orm-patterns` for `*.it.test.ts` touching the DB;
     `typescript-expert` and `zod` cross-cutting.
   - Must contain, beyond the standard skeleton:
     - The two-phase oracle-independence rule verbatim (see Design decisions).
     - Scope: `server/test/**` (`*.test.ts` unit, `*.it.test.ts` integration),
       `client/src/**/_components/<Name>/<Name>.test.tsx` colocated,
       `reviewer-core/test/**`. **`e2e/**` is out of scope** (deterministic
       agent-browser JSON flows are a separate discipline — see Risks #4).
     - Write scope: test files only. Never production source; never
       `*/src/vendor/**`; never `*/src/db/migrations/**`; never new scripts in
       `server/package.json` (skip-worktree, per `TESTING.md`).
     - Hard guardrail, stated as a non-negotiable: **fix the code, not the
       test.** Never weaken, skip, `.only`-isolate, or delete an existing
       passing test to make a suite green — report the conflict instead. Since
       `test-writer` cannot edit production code, a genuine
       code-is-wrong finding is reported and handed back to `implementer`.
     - Repo testing philosophy first (`TESTING.md`: typological, not
       exhaustive; behavior at the seams; mock the outside world via
       `server/src/adapters/mocks.ts`; one real integration per data-backed
       workflow), with the external guidance (Testing Trophy, avoid
       implementation details, coverage has diminishing returns) cited as
       *agreeing* with it — not as a competing standard.
     - Technique rules: RTL query priority `getByRole` first, `getByTestId`
       last resort, tests resembling how users interact; Fastify route tests
       use `fastify.inject()` rather than a real socket; Vitest mocks cleared/
       restored in `beforeEach`/`afterEach` to prevent cross-test leakage.
     - `*.it.test.ts` naming rule and the two typed-out server split commands.
     - The `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` fallback
       (`.\node_modules\.bin\vitest.cmd run`) from root `INSIGHTS.md`.
     - Report format `## Test Report: <task>` with sections: `Tests added`
       (file → what class of regression it catches → command + result),
       `Oracle source` (which plan item / spec line each test traces to),
       `Behavior mismatches found` (Phase-1 expectation vs observed, unresolved
       by design), `Existing tests touched` (must normally be "none — no
       existing test was weakened"), `Not covered (deliberate)`.
     - `## Model` = Sonnet.
   - Definition of done: file exists, follows the exact section order of
     `agents/researcher.md`, lists all four mirror paths in `Mirrored into:`,
     and every skill name in it resolves to a real `.claude/skills/*/SKILL.md`
     directory.

2. **Author `agents/architecture-reviewer.md` (canonical).**
   - Files/modules: `d:\htdocs\devDigest\agents\architecture-reviewer.md` (new)
   - Applicable skills: none for authoring. Persona content names
     `onion-architecture` (primary), plus `react-project-structure` and
     `next-best-practices` for client-side layering/Data-Access-Layer
     questions, and `typescript-expert` for module-boundary typing.
   - Must contain:
     - Read-only capability list per mirror exactly as tabulated in "Design
       decisions" above, including the two fallback caveats.
     - **Deterministic-tool-first workflow**, stated as a required first step:
       run `cd server && pnpm arch:check` (fallback
       `.\node_modules\.bin\depcruise.cmd --config .dependency-cruiser.cjs src`
       per root `INSIGHTS.md`), report its result, and then report **only what
       that tool cannot express**. Never re-report a violation `depcruise`
       already catches as if it were a new finding.
     - The named semantic gaps this agent owns, grounded in
       `server/.dependency-cruiser.cjs`: (a) the `PRE_EXISTING_MODULES`
       exemption at lines 10-11 means the nine listed modules get **zero**
       automated boundary checking; (b) the four rules only cover
       `service.ts` / `routes.ts` / `helpers.ts` filenames, so any other file
       in a module is unchecked; (c) semantic layering violations that are
       import-legal — domain logic living in a route handler, a service
       reaching into another module's internals, an adapter leaking
       infrastructure types through a port; (d) client-side equivalents (a
       page bypassing `src/lib/hooks/*` to `fetch` directly, per
       `client/AGENTS.md`; importing from `src/vendor/ui/<layer>/*` instead of
       the `@devdigest/ui` barrel).
     - The governing rule quoted once: the domain layer must not depend on any
       outer layer (Palermo's onion rule), and Next.js's Data-Access-Layer
       guidance as the client-side analogue.
     - **Evidence rule as a hard constraint**: every finding needs a
       `path/file.ts:LINE` citation of the actual code; a behavior claim
       inferred from a name or a folder is not a finding. No citation → the
       finding is dropped, not softened.
     - Report format `## Architecture Review: <scope>` containing: a
       `Deterministic check` line (`pnpm arch:check` result verbatim), then a
       findings **table** with columns `Severity | File:Line | Issue | Why it
       matters | Suggested direction`; severities `Critical` / `Major` /
       `Minor` / `Nit`; **at most 3 `Nit` rows** per review (excess nits are
       dropped, not appended); a `Verified clean` section listing boundaries
       actually checked and found correct; and an explicit
       "No findings" statement when there are none, never an empty report.
     - Explicit non-scope: security review, correctness/test review, and code
       style — those belong to other agents; naming them here prevents the
       drift into generic advice.
     - `## Model` = Opus.
   - Definition of done: file exists with the read-only capability list, the
     `pnpm arch:check`-first workflow, the file:line evidence constraint, the
     severity table with the Nit cap, and no capability that implies a write.

3. **Author `agents/plan-verifier.md` (canonical).**
   - Files/modules: `d:\htdocs\devDigest\agents\plan-verifier.md` (new)
   - Applicable skills: none — this agent checks compliance against a plan, it
     does not apply domain skills. State that explicitly in the file so it
     isn't mistaken for a code-quality reviewer.
   - Must contain:
     - Input contract: a Development Plan (pasted or a `docs/plans/*.md` path)
       **and** the resulting code state. Read the plan file itself rather than
       trusting a summary of it, mirroring `implementer.md`'s same rule.
     - **Context decoupling rule**: `implementer`'s Implementation Report may
       be read *only* to learn what to check (which files, which commands). Its
       claims are never evidence. Evidence comes from `git diff` / `git show`,
       the files themselves, and command output produced in this session.
     - Method, in fixed order: (1) enumerate every plan item —
       every work item, every `Definition of done` clause, every `Test plan`
       command, and every `Risks / Open questions` entry that was supposed to
       be resolved or flagged; (2) gather evidence per item; (3) only then
       assign the per-item verdict; (4) only then write the final verdict. A
       holistic judgment written before step 3 is a process violation.
     - The verdict vocabulary and final-line format exactly as specified in
       "Design decisions", including the banned-phrases list and the rule that
       any `NOT VERIFIED` row removes `PASS` from the options.
     - Anti-rubber-stamp note, stated as the known failure mode this agent
       exists to resist: LLM verifiers systematically over-validate and
       agents systematically misreport partial work as complete; the
       countermeasure is checking claims against observable state, and
       chain-of-thought alone does not fix it.
     - Capabilities: read/search/`git diff`, **plus command execution** for
       tests and typecheck — with the tool-specific write-scope table below,
       and the pnpm-no-TTY fallback from root `INSIGHTS.md`.
     - Must run, not assume, the plan's `Test plan` commands; if a command
       can't run (Docker down for `*.it.test.ts`), that's `NOT VERIFIED` with
       the blocker named, never an assumed pass.
     - Report format `## Plan Verification: <plan slug>` containing: a
       traceability table `# | Plan item (verbatim) | Evidence (file:line /
       command output) | Verdict`, then `Unplanned changes` (anything in the
       diff not traceable to a plan item), then `Blockers` (each
       `NOT VERIFIED` with its cause), then the mandatory final `VERDICT:` line.
     - `## Model` = Opus + the different-family-from-implementer preference.
   - Per-mirror capability mapping (must be written into the canonical file's
     Capabilities section and each mirror):

     | Mirror | Setting | Note |
     |---|---|---|
     | Claude | `tools: Read, Grep, Glob, Bash, AskUserQuestion` — no `Edit`/`Write`; `model: opus` | `Bash` needed for `git diff`, `vitest`, `tsc` |
     | Codex | `sandbox_mode = "workspace-write"` | Deliberately looser than it looks: test runners write caches (`tsconfig.tsbuildinfo`, `test-results/`, testcontainers state). "Never edits source" is instructional here — same shape as `planner.toml`'s note |
     | Copilot | `tools: ['search', 'codebase', 'usages', 'runCommands']` — no `editFiles` | Tool-list enforced |
     | Cursor | `readonly: false`, `model: claude-opus-5[effort=high]` | Same cache-write reason as Codex; the one mirror where this persona is looser than in Claude/Copilot — say so explicitly, as `.cursor/agents/README.md` already does for `planner` |
   - Definition of done: file exists; the three per-item verdicts and three
     final verdicts appear verbatim; the banned-phrase list is present; the
     evidence-before-verdict ordering is stated as a hard constraint.

4. **Author `agents/doc-writer.md` (canonical).**
   - Files/modules: `d:\htdocs\devDigest\agents\doc-writer.md` (new)
   - Applicable skills: `mermaid-diagram` (named in the persona as the skill it
     applies for every diagram). No other catalog skill applies.
   - Must contain: the 7-branch placement rule, the `docs/**`-only write scope,
     the "never a fifth top-level `docs/` subsection without asking" rule, the
     root-`AGENTS.md`-index proposed-diff requirement, the diagram-type-by-
     purpose rule with the one-diagram default, the Mermaid-fails-silently
     gotcha, and the grounding rule — all as specified in "Design decisions".
   - Must also contain the **"Not to be confused with `docs/agent-prompts/`"**
     note (copy the wording from `agents/researcher.md:20-22`) — load-bearing
     for this persona specifically, because it is the one agent whose write
     scope overlaps that directory's parent.
   - Report format `## Documentation Report: <feature>`: `Files written`
     (path + which placement branch chose it + why), `Diagrams` (type +
     what question it answers), `Grounded in` (the real source paths read),
     `Requires human/implementer to apply` (the root `AGENTS.md` §Docs index
     line, plus any package-README edit it could not make), `Not documented
     (deliberate)`.
   - Per-mirror capability mapping: Claude `tools: Read, Grep, Glob, Bash,
     Write, Edit, Skill, AskUserQuestion`, `model: sonnet`; Codex
     `sandbox_mode = "workspace-write"`; Copilot `tools: ['search',
     'codebase', 'usages', 'editFiles', 'runCommands']`; Cursor
     `readonly: false`, `model: inherit`. In all four, `docs/**`-only is
     instructional (but see Risks #2 for a possible Claude-side settings-level
     tightening).
   - Definition of done: file exists; the placement rule is written as an
     ordered first-match-wins list naming the exact directories; `specs/`,
     `docs/plans/`, and all package source are explicitly named as never-write.

5. **Amend `agents/implementer.md` so it doesn't contradict `test-writer`.**
   - Files/modules: `d:\htdocs\devDigest\agents\implementer.md`
   - Applicable skills: none
   - Changes: (a) `## Role` — state that authoring *new* tests for new behavior
     is `test-writer`'s job; `implementer` runs existing suites and may only
     add a test when explicitly instructed by a plan work item, noting it in
     `Deviations`. (b) `## Executing a work item` step 4 — clarify the
     self-check is "existing suites pass", not "I wrote the tests". (c) Report
     format `### Out of scope (deferred)` — extend the line to name all four
     new agents rather than just "architecture review, security review".
   - Definition of done: no sentence in `implementer.md` still implies it owns
     new-test authorship; the four new agent names appear in its out-of-scope
     line. (Its four mirrors are updated in WI7-WI10.)

6. **Update `agents/README.md` (canonical index).**
   - Files/modules: `d:\htdocs\devDigest\agents\README.md`
   - Applicable skills: none
   - Changes: (a) add four rows to "Agents at a glance" using the existing six
     columns (`Agent | Responsibility | Capabilities (tool-agnostic) | Model |
     Reads (input) | Produces (output)`) — values per the tables in "Design
     decisions"; (b) replace the "Handoff chain" block with the new diagram +
     the three prose bullets; (c) extend "Why the write/approval boundaries
     read differently per mirror" to cover the three new boundary shapes:
     fully-read-only (`architecture-reviewer`), read-only-but-needs-command-
     execution (`plan-verifier`), and path-scoped-write (`test-writer` → test
     files, `doc-writer` → `docs/**`); (d) extend the "Sources for planner's
     and implementer's rules" section into a per-persona sources list carrying
     the URLs from this plan's `### Sources` section.
   - Definition of done: the table has 7 rows; the diagram matches this plan
     verbatim; every new persona appears in the sources section.

7. **Mirror all four personas into `.claude/agents/` and update its README.**
   - Files/modules: `.claude/agents/test-writer.md`,
     `.claude/agents/architecture-reviewer.md`, `.claude/agents/plan-verifier.md`,
     `.claude/agents/doc-writer.md` (all new), `.claude/agents/implementer.md`
     (WI5 sync), `.claude/agents/README.md`
   - Applicable skills: none
   - Frontmatter values are fixed by WI1-WI4's per-mirror tables. Each file
     needs the `<!-- Mirrored from agents/<name>.md — edit that file first… -->`
     comment. `description` must include a "use PROACTIVELY when…" trigger
     sentence in the style of `.claude/agents/researcher.md`.
   - README: 4 new rows in its "Agents at a glance" (columns `Agent |
     Responsibility | Tools (permissions) | Model | Reads | Produces`), the new
     handoff diagram, and a note under the table that `architecture-reviewer`
     joins `researcher` as a tool-allowlist-enforced read-only agent while
     `plan-verifier` is read-only-except-`Bash`.
   - Definition of done: 4 new files + 2 updated; every `tools:` list matches
     this plan exactly; no new file grants `Edit`/`Write` to
     `architecture-reviewer` or `plan-verifier`.

8. **Mirror all four personas into `.codex/agents/` and update its README.**
   - Files/modules: `.codex/agents/test-writer.toml`,
     `architecture-reviewer.toml`, `plan-verifier.toml`, `doc-writer.toml` (new),
     `.codex/agents/implementer.toml` (WI5 sync), `.codex/agents/README.md`
   - Applicable skills: none
   - `sandbox_mode`: `test-writer` = `workspace-write`;
     `architecture-reviewer` = `read-only`; `plan-verifier` =
     `workspace-write` (with the cache-write justification comment);
     `doc-writer` = `workspace-write`. `architecture-reviewer` becomes the
     second `read-only` agent in this mirror alongside `researcher` — the
     README's "one mirror where the sandbox enforces no-writes" note must be
     updated from singular to cover both.
   - README: replace "Same three agents as every other mirror" with seven;
     add the four rows; add a note that `plan-verifier`'s `workspace-write` is
     the same looks-looser-than-it-is situation `planner` already documents.
   - Definition of done: 4 new `.toml` + 2 updated; `developer_instructions`
     bodies are faithful prose renderings of the canonical files (Codex has no
     skills mechanism, so skill references are file paths).

9. **Mirror all four personas into `.github/agents/` and update its README.**
   - Files/modules: `.github/agents/test-writer.agent.md`,
     `architecture-reviewer.agent.md`, `plan-verifier.agent.md`,
     `doc-writer.agent.md` (new), `.github/agents/implementer.agent.md`
     (WI5 sync), `.github/agents/README.md`
   - Applicable skills: none
   - `tools:` arrays exactly as in WI1-WI4. **Model is never pinned** here —
     use a `# model:` comment deferring to the user's Copilot setup, per
     `.github/agents/README.md:57-60`; for `architecture-reviewer` and
     `plan-verifier` the comment should say "strongest reasoning tier
     available", matching how `planner.agent.md` handles it.
   - README: update "Same three agents" → seven; add four rows; extend the note
     about `researcher` being "the only agent without `editFiles`" to name
     `architecture-reviewer` and `plan-verifier` too.
   - Definition of done: 4 new `.agent.md` + 2 updated; no pinned model id
     anywhere; `editFiles` absent from `architecture-reviewer` and
     `plan-verifier`.

10. **Mirror all four personas into `.cursor/agents/` and update its README.**
    - Files/modules: `.cursor/agents/test-writer.md`,
      `architecture-reviewer.md`, `plan-verifier.md`, `doc-writer.md` (new),
      `.cursor/agents/implementer.md` (WI5 sync), `.cursor/agents/README.md`
    - Applicable skills: none
    - `readonly`: `test-writer` `false`; `architecture-reviewer` **`true`**
      (platform-enforced — plus the `depcruise`-may-be-blocked fallback
      comment); `plan-verifier` `false` (with the explicit "looser here than in
      Claude/Copilot, instruction-enforced no-source-edit" comment);
      `doc-writer` `false`. `model`: `claude-opus-5[effort=high]` for
      `architecture-reviewer` and `plan-verifier`, `inherit` for `test-writer`
      and `doc-writer` — and each pinned file must carry the existing
      "pinned model can be silently ignored" caveat comment already used in
      `.cursor/agents/planner.md`.
    - README: update "Same three agents" → seven; add four rows; extend the
      "`researcher.md` is the only one where `readonly: true` is
      platform-enforced" note to include `architecture-reviewer`.
    - Definition of done: 4 new files + 2 updated; `readonly: true` present on
      `architecture-reviewer` only among the new four.

11. **Fix the stale mirror paths in root `AGENTS.md` and add the new agents to
    the docs index.**
    - Files/modules: `d:\htdocs\devDigest\AGENTS.md`
    - Applicable skills: none
    - The §Cross-cutting conventions bullet currently says personas are
      mirrored into "`.claude/agents/`, `.codex/agents/`, `.github/chatmodes/`,
      and `.cursor/rules/`". The real directories are **`.github/agents/`** and
      **`.cursor/agents/`** (verified: those are the directories that exist and
      the ones every mirror README documents). Correct both paths.
    - Keep root `AGENTS.md` within its own ≤100-line / map-not-documentation
      rule (root `INSIGHTS.md:5`): do not add per-agent prose here; if a
      pointer is warranted, one link to `agents/README.md` is enough.
    - Definition of done: `git grep -n "chatmodes\|cursor/rules"` returns
      nothing in `AGENTS.md`.

## Test plan

No package source is touched, so **no package test suite applies** — running
`client`/`server`/`reviewer-core`/`e2e` suites would prove nothing about this
change and is not part of this plan. Verification is a parity checklist
instead:

- `git status --porcelain` — confirm no file under `server/src/`,
  `client/src/`, `reviewer-core/src/`, or `e2e/` is modified. Any such file
  means scope was exceeded.
- `git grep -n "chatmodes\|cursor/rules" -- AGENTS.md` — must return nothing
  (WI11).
- For each of `test-writer`, `architecture-reviewer`, `plan-verifier`,
  `doc-writer`: confirm 5 files exist (1 canonical + 4 mirrors) and that the
  canonical file's `Mirrored into:` list matches the four real paths.
- `git grep -n "test-writer\|architecture-reviewer\|plan-verifier\|doc-writer"
  -- agents/README.md .claude/agents/README.md .codex/agents/README.md
  .github/agents/README.md .cursor/agents/README.md` — all four names must
  appear in all five READMEs.
- Every skill name referenced in the four new canonical files must resolve to
  a real directory under `.claude/skills/` (`onion-architecture`,
  `react-testing-library`, `react-best-practices`, `react-project-structure`,
  `next-best-practices`, `fastify-best-practices`, `drizzle-orm-patterns`,
  `typescript-expert`, `zod`, `mermaid-diagram`).
- Grep the new mirrors for accidental write grants: `Edit`/`Write` must not
  appear in `.claude/agents/architecture-reviewer.md` or
  `.claude/agents/plan-verifier.md`'s `tools:` line; `editFiles` must not
  appear in their `.github` counterparts.
- If (and only if) the implementer decides to sanity-check that nothing broke
  in a package, the commands from that package's `AGENTS.md` are:
  `cd client && pnpm test`; `cd server && pnpm exec vitest run --exclude
  '**/*.it.test.ts'` (unit) and `pnpm exec vitest run .it.test` (integration,
  needs Docker); `cd reviewer-core && npm test`; `cd e2e && npm test`. Expect
  them to be unaffected.

## Risks / Open questions

1. **Amending `agents/implementer.md` (WI5) edits an existing persona.** It is
   necessary — otherwise `implementer` and `test-writer` both claim test
   authorship — but it touches 5 files (canonical + 4 mirrors) beyond the "add
   four agents" headline. Confirm with the user before executing WI5 if scope
   discipline matters more than consistency here.
2. **Possible stale claim across five READMEs.** `agents/README.md:54-66` and
   each mirror README assert that *none* of the four tools support path-scoped
   write permissions. Claude Code's permissions documentation describes
   path-scoped rules of the form `Edit(docs/**)` — while `Write(docs/**)` is
   *not* honored for path scoping. If that holds against the current docs, then
   (a) `doc-writer`'s `docs/**` scope could be partly platform-enforced via
   repo settings (`.claude/settings.json` `permissions.allow`/`deny`), not the
   subagent file, and (b) the "none of the four" wording in five READMEs is
   wrong. **Do not rewrite those five READMEs on the strength of this plan
   alone** — verify against the current Claude Code permissions and sub-agents
   docs first, then either correct the wording or record why it stands. Per
   `agents/planner.md`, a planner cannot fix docs itself; this is flagged for
   `implementer`.
3. **Root `AGENTS.md` currently names non-existent mirror directories**
   (`.github/chatmodes/`, `.cursor/rules/`). WI11 fixes it; flagged separately
   because it is a pre-existing bug this task merely surfaced, and because it
   is the kind of entry `implementer` should also consider recording in
   `INSIGHTS.md`.
4. **`e2e/` is excluded from `test-writer`'s scope.** Rationale: `e2e/` uses
   deterministic agent-browser batch JSON (`e2e/specs/*.flow.json`) restricted
   to `--url`/`--text`/`find` locators with the AI `chat` command banned
   (`TESTING.md` §Conventions) — a different authoring discipline from
   Vitest/RTL, with no catalog skill covering it. Confirm this exclusion is
   intended; if not, `test-writer` needs a whole additional section and
   `e2e/AGENTS.md` becomes required reading for it.
5. **`plan-verifier` cannot always gather integration evidence.** Docker is not
   auto-started in this environment (root `INSIGHTS.md` §Tool & Library Notes),
   so `*.it.test.ts` evidence may be unavailable. The `NOT VERIFIED` +
   blocker mechanism handles this honestly, but it means a plan touching
   DB-backed routes will frequently be unable to reach `VERDICT: PASS` here.
   That is the intended behavior, not a defect — confirm the user agrees before
   this becomes a recurring friction point.
6. **The "prefer a different model family for `plan-verifier`" recommendation
   is aspirational in three of four mirrors.** Cursor and Claude Code both run
   Claude-family models by default, and Copilot's available models depend on
   the user's org. The self-preference-bias mitigation is therefore a documented
   preference, not something any mirror can enforce — the persona file must say
   so rather than implying it is guaranteed.
7. **`architecture-reviewer` may be unable to run `depcruise` under Cursor
   `readonly: true` or Codex `read-only`.** The paste-the-output fallback is
   specified, but it has not been empirically verified in either tool. First
   real run should confirm and, if it fails, `implementer` should record the
   result in `INSIGHTS.md`.
8. **New `docs/` subsections are defined but empty.** `docs/features/`,
   `docs/how-to/`, `docs/reference/`, `docs/adr/` are named by the placement
   rule but this plan does **not** create them — `doc-writer` creates a
   directory when it first writes into it. Confirm that is preferable to
   committing placeholder READMEs (recommendation: yes, empty scaffolding rots).
9. **Volume.** WI1-WI11 produce 16 new files and update 8 existing ones. If
   this must be split, the natural cut is canonical-first (WI1-WI6, WI11) as
   one change and the 16 mirrors (WI7-WI10) as a second — the canonical files
   are usable on their own, and the repo's convention already treats mirror
   divergence as a known, correctable bug class.

## Explicitly out of scope

- Architecture review, security review of this change — separate agents own
  these. (`architecture-reviewer`, once it exists, would have nothing to review
  here: no source code is touched.)
- Authoring a `security-reviewer` persona; the handoff chain keeps it as an
  explicit placeholder.
- Any change to `.claude/skills/**`.
- Writing actual documentation into the new `docs/` subsections.

## Sources

External sources that materially shaped the design decisions above, grouped by
the persona each informed. These belong in `agents/README.md`'s per-persona
sources section (WI6) as well.

**`test-writer`**
- Anthropic — Best practices for Claude Code (Writer/Reviewer split: "have one
  Claude write tests, then another write code to pass them") —
  https://code.claude.com/docs/en/best-practices
- Arthur Hertweck — "the oracle must be independent of the generator";
  tautological tests arise when one model infers the spec from its own
  implementation — https://arthurhertweck.dev/writing/tautological-testing
- Testing Library — query priority (`getByRole` first, `getByTestId` last
  resort); tests should "resemble how users interact with your code" —
  https://testing-library.com/docs/queries/about/
- Kent C. Dodds — avoid testing implementation details —
  https://kentcdodds.com/blog/testing-implementation-details
- Kent C. Dodds — Testing Trophy; favor integration tests, minimize mocking,
  coverage has diminishing returns past ~70% —
  https://kentcdodds.com/blog/write-tests
- Fastify — official testing guide, `fastify.inject()` for route/integration
  tests without a real socket — https://fastify.dev/docs/latest/Guides/Testing/
- Vitest — mocking guide; clear/restore mocks in `beforeEach`/`afterEach` to
  avoid cross-test leakage — https://vitest.dev/guide/mocking
- Peter Phonix — test automation guardrails: "the AI should fix the code, not
  the tests"; never weaken or delete a passing test to make a suite green —
  https://medium.com/@peterphonix/test-automation-guardrails-0e1a18ee064f

**`architecture-reviewer`**
- Claude Code — Code Review: behavior claims need a `file:line` citation in the
  source rather than an inference from naming; Severity + File:Line + Issue
  table; cap low-value "Nit" comments — https://code.claude.com/docs/en/code-review
- Google — engineering practices, reviewer comments: explain *why*, use
  explicit severity labels, avoid vague prose —
  https://google.github.io/eng-practices/review/reviewer/comments.html
- Jeffrey Palermo — The Onion Architecture, Part 1: the domain layer must not
  depend on any outer layer —
  https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/
- Next.js — Data Access Layer guidance so routes don't bypass the service layer
  — https://nextjs.org/blog/security-nextjs-server-components-actions
- ArchUnitTS — layer rules and `.should().haveNoCycles()` as test assertions
  (deterministic tools own binary/structural rules) —
  https://github.com/LukasNiessen/ArchUnitTS
- madge — circular dependency detection — https://www.npmjs.com/package/madge
- Xebia — taking frontend architecture seriously with dependency-cruiser
  (import-graph rules) —
  https://xebia.com/blog/taking-frontend-architecture-serious-with-dependency-cruiser/

**`plan-verifier`**
- Galtea — LLM-as-a-judge prompts, templates, rubrics: enumerate every
  requirement with evidence *first*, then assign a binary verdict per item;
  never a holistic score first —
  https://galtea.ai/blog/llm-as-a-judge-prompts-templates-rubrics-and-best-practices
- arXiv 2507.11662 — LLM verifiers systematically over-validate flawed work;
  true-negative detection as low as 50%, resistant to chain-of-thought alone —
  https://arxiv.org/html/2507.11662v3
- arXiv 2604.06996 — self-preference/confirmation bias: a judge from the same
  model family as the implementer rates that work more favorably —
  https://arxiv.org/pdf/2604.06996
- arXiv 2606.09863 — "false success": agents misreport partial work as
  complete at high rates; the fix is checking claims against observable state
  (tests, execution, diffs), not the narrative —
  https://arxiv.org/html/2606.09863
- obra/superpowers — spec-compliance verification as a distinct PRIOR gate to
  code-quality review; per-item evidence required; "looks good overall"
  explicitly unacceptable; non-hedgeable final verdict —
  https://deepwiki.com/obra/superpowers/6.8-code-review-process
- TestRail — Requirements Traceability Matrix (requirement → evidence →
  verdict) — https://www.testrail.com/blog/requirements-traceability-matrix/

**`doc-writer`**
- Diátaxis — tutorials / how-to / reference / explanation as the categorization
  for "which section does this belong in" — https://diataxis.fr/ and
  https://diataxis.fr/reference/
- arc42 — Building Block View (static structure) vs Runtime View (behavior /
  scenarios), used here as diagram-type-per-section — https://arc42.org/overview/
- ADR GitHub organization — ADRs live at `docs/adr/NNNN-title.md`, one decision
  per file, sequential numbering — https://adr.github.io/gadr/docs/adr/
- C4 model — "you don't need to use all 4 levels of diagram; only those that
  add value" — https://c4model.com/diagrams
- Google — documentation best practices: update docs in the same change as the
  implementation; stale docs are worse than none —
  https://google.github.io/styleguide/docguide/best_practices.html
- Claude Code — permissions and sub-agents: path-scoped write restriction via
  `Edit(docs/**)`; `Write(docs/**)` is *not* honored for path scoping —
  https://code.claude.com/docs/en/permissions and
  https://code.claude.com/docs/en/sub-agents (see Risks #2 — verify before
  acting on this)
