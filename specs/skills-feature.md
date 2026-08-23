# Skills for review agents

Status: planned. Scope agreed 2026-08-02.

Skills are reusable, markdown-only prompt fragments that can be linked to
multiple review agents, ordered per agent, and toggled on/off per agent.
They carry no executable payload — only the config text format already used
for an agent's system prompt.

## 0. What already exists (don't rebuild)

The `agents` foundation shipped in an earlier lesson already carries most of
the plumbing this feature needs:

| Piece | Status | Where |
|---|---|---|
| `skills` / `skill_versions` tables (`type: rubric\|convention\|security\|custom`, `source: manual\|imported_url\|extracted\|community`, body, enabled, version) | done | `server/src/db/schema/skills.ts` |
| `agent_skills` join table (agentId, skillId, order) | done | `server/src/db/schema/agents.ts:51` |
| `GET/POST /agents/:id/skills` (link, reorder, toggle) | done | `server/src/modules/agents/routes.ts:145` |
| `parts.skills` slot in prompt assembly → renders as `## Skills / rules` | done | `reviewer-core/src/prompt.ts:43,88-109` |
| Skills block in the run trace viewer (renders when `prompt_assembly.skills != null`) | done | `client/.../RunTraceDrawer/_components/TraceBody/TraceBody.tsx:76-78` |
| Standard findings JSON schema | done | `server/src/vendor/shared/contracts/findings.ts` |
| Eval infra (`eval_cases`, `eval_runs`, `conformance_checks`) | done | `server/src/db/schema/eval.ts` |
| Standalone `/skills` CRUD (create/edit a skill's own fields) | **done** | `server/src/modules/skills/` |
| `client/messages/en/skills.json` (list/detail/import-drawer copy, already fully authored) | done | `client/messages/en/skills.json` |
| Client Skills page (grid + preview) | **missing** | — |
| Skills tab in Agent Editor | **missing (stubbed)** | `AgentEditor.tsx` — comment: "Later lessons add Skills/Evals/Stats/CI tabs" |
| Import flow (file / URL / community → skill row) | **missing** | — |
| `run-executor.ts` actually populating `parts.skills` | **missing** — currently hardcodes `skills: null` | `server/src/modules/reviews/run-executor.ts:429` |

No schema migration is required. `type` enum already matches the mockup's
badges; `source: 'extracted'` is the exact fit for "product extracts the
skill core" on import.

## 1. Server — new `server/src/modules/skills/`

Mirror `modules/agents` (routes → service → repository; onion architecture —
domain/application code never imports infrastructure directly).

- `GET /skills`, `POST /skills`, `GET /skills/:id`, `PUT /skills/:id`, `DELETE /skills/:id`
- `GET /skills/:id/versions`, `GET /skills/:id/versions/:version` (mirrors agent-versions)

**Import — reconciled 2026-08-02** against the pre-built
`client/messages/en/skills.json` copy, which describes three import paths
and no "create from scratch" option (superseding the earlier zip+`SKILL.md`
design). None of the three forms collects `type` or `description`; both
default (`type: 'custom'`, `description: ''`) and are refined afterward via
`PUT /skills/:id` from the preview/detail panel.

- `POST /skills/import/file` — `{ name?, body }`. `name` derived from the
  first `# heading` when omitted. `source: 'extracted'`, `enabled: true`
  (user-supplied content, no external fetch involved).
- `POST /skills/import/url` — `{ url }`. Server fetches the URL server-side,
  stores the response as plain text (never executed). `source:
  'imported_url'`, `enabled: false` — needs vetting before use, matching the
  UI copy ("Disabled until you vet + enable it"). **SSRF guard required**:
  `https://` only, response size cap, short timeout.
- `GET /skills/community?q=&lang=` — search a small **static, in-repo**
  catalog (no live external registry — out of scope for this lab). Returns
  `CommunitySkill[]` (name/repo/stars/lang/desc — already defined in
  `@devdigest/shared`).
- `POST /skills/import/community` — `{ id }`, resolves the catalog entry's
  body server-side. `source: 'community'`, `enabled: false`.

**Prompt wiring** (the one real net-new behavior on the reviewer path): in
`run-executor.ts`, before the review call, fetch
`agent_skills JOIN skills WHERE agentId=? AND skills.enabled=true ORDER BY agent_skills.order`,
map each row's body to a string (prefixed with `### {name}` for
readability in the trace block), and pass as `skills` alongside the existing
`callers`/`repoMap`/`prDescription` args (currently built at
`run-executor.ts:194-213`). No new trace/token UI is needed — `stats.tokens_in`
already reflects the full assembled prompt, so once skills land in the
prompt the trace's token count reflects them automatically.

## 2. Client

- **`client/src/app/skills/`** — list + side preview (master-detail), driven
  by the already-authored `client/messages/en/skills.json`. "Add Skill"
  opens a menu with exactly three items — **Import from file / Import from
  URL / Search community skills** — no blank "create from scratch" entry;
  that copy doesn't exist in the pre-built i18n and we're following it as
  source of truth over the earlier draft of this spec.
- **Skill preview/detail panel** — read-only view + "Edit"/"Save" (per the
  `preview` i18n block); editing `body` creates a new immutable version
  (already wired server-side). This is also where `type` and `description`
  — never collected at import time — get set.
- **Agent Editor → Skills tab** — unstub it. Checkbox list (enabled),
  drag-to-reorder (writes `order`), type badge. Backend API already exists;
  this is client-only work.
- **Import drawer** — three tabs (file/url/community) per `drawer.tabs` in
  the i18n file; each tab posts to its own endpoint above. The existing
  "needs vetting" / "Untrusted source — vet before enabling" copy renders
  as a badge on the skill card/preview whenever `enabled: false` and
  `source !== 'extracted'`.

## 3. New agent: Test Quality Reviewer

One agent (API Contract experiment dropped from scope per 2026-08-02
decision). Its description names four concerns → four skills, 1:1:

| Skill | Type | Source | Catches |
|---|---|---|---|
| `branch-coverage-gate` | rubric | manual | New `if/else`/`switch`/early-return/`catch` with no test exercising each branch |
| `corner-case-gate` | rubric | manual | Missing tests for boundary/empty/null/error inputs on new functions |
| `mock-overuse-gate` | rubric | manual | Test mocks so much of the unit under test that the assertion only checks the mock was called |
| `flaky-test-gate` | rubric | **extracted (import)** | Real timers/sleep, unseeded randomness, shared mutable state across tests |

`flaky-test-gate` is added via the import flow specifically to exercise that
path end-to-end.

**Constraint:** the agent's static system prompt must stay deliberately
generic ("review this diff for test quality"). All detection specificity
lives in the skills — otherwise the control experiment (below) won't show a
contrast between skills-off and skills-on runs.

## 4. Control experiment — via existing eval infra

Rather than one-off manual testing, use the existing `eval_cases`/`eval_runs`
tables: one eval case = a PR fixture with a happy-path-only test. Two eval
runs of Test Quality Reviewer against it — skills disabled vs enabled.
Expected: skills-off run passes with no coverage findings; skills-on run
flags the uncovered branch and the missing corner case.

## 5. Implementation order

1. `server/src/modules/skills` (CRUD + versions), unit-tested
2. Client: Skills page + skill editor
3. Unstub Skills tab in Agent Editor (API already exists)
4. Import endpoints — file/url/community (server) + import drawer UI (client)
5. Wire `run-executor.ts` to populate real `parts.skills`
6. Create Test Quality Reviewer + 4 skills (3 manual + 1 import)
7. Eval case for the control experiment; run both skills-off/on states

## 6. Open questions (non-blocking, decide before/while touching the relevant step)

- Keep the `type` enum fixed to `rubric/convention/security/custom`, or
  allow extension for future categories?
- Skills are per-workspace in the current schema (no shared/community
  catalog across workspaces) — `source: 'community'` hints at a future tier,
  out of scope here. The community *catalog* itself (this spec's static
  in-repo list) is global, not workspace-scoped — only the imported copy a
  workspace creates from it is.
- Body sanitization beyond "never executed, never rendered as HTML" —
  `prompt.ts:6`'s "community skills should be sanitized upstream" note is
  addressed here by the enabled-false-until-vetted default on url/community
  imports, not by transforming the text itself. Revisit if insufficient.

## 7. Non-functional requirements

- **Security — no execution, ever.** A skill's `body` is always plain text
  fed into the LLM prompt (`## Skills / rules` block); it is never parsed as
  code, never rendered as HTML, never used to construct a shell command or
  file path. This holds regardless of `source`.
- **Security — SSRF.** Covered in §1: `https://` only, 8s timeout, 200KB
  hard cap enforced by streaming (not trusting `content-length`). No
  DNS-based private-IP blocking yet — flagged as a known gap in §1, not
  something to silently claim as solved.
- **Trust default, not sanitization.** Untrusted sources (`imported_url`,
  `community`) land `enabled: false`; nothing reaches a live prompt without
  a human enabling it first. This is the actual mitigation for "community
  skills should be sanitized upstream" (`prompt.ts:6`) — not text
  transformation.
- **Tenant isolation.** Every skill read/write is workspace-scoped at the
  repository layer (`workspaceId` parameter on every `SkillsRepository`
  method, per the onion-architecture port-pattern rule) — never inferred
  from request context inside a Drizzle query.
- **Cost/token budget.** A skill's body is not size-capped on `file`
  import (only `url` import is, for SSRF/DoS reasons) — but every enabled
  skill linked to an agent adds directly to that agent's per-review token
  cost. No enforced limit in this pass; worth a soft UI warning (e.g. "this
  skill is N tokens") before it becomes a real cost surprise.
- **Availability.** A failed `url` import (bad URL, timeout, oversized
  response) fails the import call itself — it never reaches a linked,
  enabled state, so it cannot break a review run in progress. Review runs
  never call out to skill sources at run time; they only read already-
  persisted skill bodies from the DB.
- **Observability.** Already covered structurally: the skills block in the
  assembled prompt is visible per-run in the trace viewer (§0), so a
  reviewer can always see exactly what skill text a given run actually saw.

## Acceptance checklist

- [ ] Skill created and edited in the UI
- [ ] Both skill types needed for Test Quality Reviewer exist and are linked
- [ ] An enabled skill shows as its own block in the run trace; a disabled
      one does not
- [ ] All three import paths (file/URL/community) work; url/community
      imports land disabled until manually enabled; nothing executable
      ever runs
- [ ] Control experiment reproduces on the Test Quality Reviewer agent
      (skills-off = pass, skills-on = flags coverage + corner case)
