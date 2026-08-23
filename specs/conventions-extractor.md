# Conventions Extractor + API Contract Reviewer

Status: planned. Scope agreed 2026-08-02 (this session).

Two related pieces of L02 homework:

1. **Conventions Extractor** — scans a repo, proposes house-rule candidates
   with evidence, lets a user accept/reject/edit them, and promotes accepted
   candidates into a real Skill (reusing the already-shipped Skills feature).
2. **API Contract Reviewer** — a new review agent + 4 skills that demonstrate
   the Skills feature's value with a before/after experiment (skills-off run
   misses a breaking API change, skills-on run catches it).

> Note: `specs/skills-feature.md` §3 records a 2026-08-02 decision to drop
> the "API Contract" experiment in favor of "Test Quality Reviewer" — that
> decision predates this homework assignment, which explicitly asks for API
> Contract Reviewer. This spec follows the homework. Treat Test Quality
> Reviewer in the other spec as a working reference for the same mechanics
> (agent + skills + skills-off/on contrast), not a constraint.

## 0. What already exists (don't rebuild)

| Piece | Status | Where |
|---|---|---|
| `conventions` table (`rule, evidencePath, evidenceSnippet, confidence, accepted`) | done, migrated | `server/src/db/schema/knowledge.ts:31-42` |
| `repoIntel.getConventionSamples(repoId, n)` — top-N files by rank, junk-filtered | done | `server/src/modules/repo-intel/service.ts:629` |
| `FEATURE_MODELS['conventions']` registry entry (cheap-model default) | done, unwired | `server/src/vendor/shared/contracts/platform.ts:72-78` |
| `resolveFeatureModel()` / `getFeatureModelOverride()` | done, zero call sites | `server/src/modules/settings/feature-models.ts` |
| `LLMProvider.completeStructured<T>()` (structured JSON output) | done | `server/src/adapters/llm/{openai,anthropic}.ts` |
| Skills CRUD (`POST /skills`, `type: convention`, `source: extracted`) | done | `server/src/modules/skills/` |
| Skill ↔ agent linking (`GET/POST /agents/:id/skills`) | done | `server/src/modules/agents/routes.ts:145` |
| Prompt wiring — linked+enabled skills render as `## Skills / rules` | done | `server/src/modules/reviews/run-executor.ts:190-198` |
| `client/messages/en/conventions.json` (page + card copy) | done, pre-authored | `client/messages/en/conventions.json` |
| `/conventions` client route | **missing** | — |
| `server/src/modules/conventions/` | **missing** | — |
| Mock LLM hint for a 2-step dialogue (`ConventionFileSelection` → `ConventionExtraction`) | naming precedent only, not implemented | `server/src/adapters/mocks.ts:48-53` |

No new table is required. `conventions` gets three added columns (below), via
the normal `drizzle-kit generate` flow — not a new table, not a hand-edited
migration.

## 1. Schema change — extend `conventions`

`server/src/db/schema/knowledge.ts`:

- `category: text('category')` — free-text grouping (e.g. `"async"`,
  `"error-handling"`), shown on the candidate card.
- `status: text('status', { enum: ['pending','accepted','rejected'] }).notNull().default('accepted')`
  replaces the plain `accepted` boolean — the mockup's Accepted/Reject is a
  3-state toggle (extraction defaults every candidate to accepted; the user
  deselects bad ones), and `pending` is reserved for a future "needs review"
  state. `accepted` boolean column is dropped in the same migration.
- `skillId: uuid('skill_id').references(() => skills.id, { onDelete: 'set null' })`
  — set when a candidate is promoted into a real skill; lets re-scan skip
  candidates that already became a skill instead of re-surfacing them as new.

Generate via `cd server && pnpm db:generate`, apply via `pnpm db:migrate`
(never hand-edit the generated SQL).

## 2. Server — new `server/src/modules/conventions/`

Mirror `modules/skills/` (routes → service → repository port/adapter, onion
architecture — checked by `pnpm arch:check`).

- **`POST /repos/:id/conventions/extract`**
  1. Config sample: read `.eslintrc*`, `tsconfig.json`, `.prettierrc*` from
     the repo root (plain fs read, no model call).
  2. Ranked sample: `repoIntel.getConventionSamples(repoId, 12)`.
  3. Read file contents for the combined sample (size-capped per file).
  4. `resolveFeatureModel(container, workspaceId, 'conventions')` →
     `llm.completeStructured<ConventionCandidate[]>()`, schema:
     `{ category, rule, evidence: { file, line }, confidence }`.
  5. **Grounding check** (code, not model): discard any candidate whose
     `evidence.file` isn't in the sampled set, or whose `evidence.line`
     doesn't exist in that file. Ungrounded candidates never reach the DB.
  6. Replace the repo's previous *unpromoted* candidates (`skillId IS NULL`)
     with the new grounded set, `status: 'accepted'` by default.
- **`GET /repos/:id/conventions`** — list current candidates for a repo.
- **`PATCH /conventions/:id`** — `{ status?, rule?, evidencePath?, evidenceSnippet? }`
  → accept/reject/edit a single candidate.
- **`POST /conventions/promote`** — `{ conventionIds, skill: { name, description, type, body, enabled } }`
  → creates one skill via the existing `SkillsService.create()`
  (`type: 'convention'`, `source: 'extracted'`), then sets `skillId` on the
  given `conventionIds`.

## 3. Client

- **`client/src/app/conventions/`** — list view (`ConventionsListView`),
  driven by the pre-authored `client/messages/en/conventions.json`
  (`page`/`card` namespaces already cover the list; a `modal` namespace
  needs to be added for the create-skill modal, following the pattern of
  `skills.json`'s import-drawer copy).
  - `ConventionCard` — rule title, evidence `file:line` with snippet,
    confidence bar, Accepted/Reject toggle, inline edit.
  - `Run extraction` / `Re-scan` action → `POST /repos/:id/conventions/extract`.
- **`client/src/lib/hooks/conventions.ts`** — `useConventions`,
  `useExtractConventions`, `useUpdateConvention`, `usePromoteToSkill` (same
  shape as `hooks/skills.ts`).
- **Create-skill modal** — opened from selected accepted candidates.
  Client builds a draft markdown body (group selected candidates by
  `category`, one `##` section per rule with its evidence), pre-fills
  Name/Description/Type/Enabled, everything editable before save. Submits
  via `POST /conventions/promote`.

## 4. New agent: API Contract Reviewer

System prompt stays deliberately generic ("review this diff for API
contract concerns") — no contract-specific detection logic in the base
prompt, so the skills-off/skills-on contrast in §5 is real, not already
solved by the agent's own prompt (same lesson already validated for Test
Quality Reviewer in `specs/skills-feature.md`).

4 skills, each `type: rubric`, directive rule + good/bad example:

| Skill | Source | Catches |
|---|---|---|
| `breaking-change` | manual | Change or removal of a public route/field/type contract |
| `response-schema` | manual | Response shape changes (types, field required-ness) |
| `semver-discipline` | manual | Changes that require a major version bump |
| `deprecation-policy` | **import (file)** | Silent removal instead of a deprecation marker |

`deprecation-policy` goes through `POST /skills/import/file` specifically to
exercise that path end-to-end, per the assignment.

## 5. Control experiment

1. Pick or create a PR against a **real, locally cloned repo** (not the
   seeded `acme/payments-api` fixture — its `clone_path` is `null`) that
   changes a route signature or renames a response field.
2. `POST /agents/:id/skills { skill_ids: [] }` (skills off) → run the
   review → expect no breaking-change finding.
3. `POST /agents/:id/skills { skill_ids: [...] }` (all 4 back) → run again
   → expect a `CRITICAL`/`WARNING` finding citing the exact changed
   `file:line`.
4. Compare via the Run Trace Viewer (`## Skills / rules` block present only
   on run 2) and the Findings list.

## 6. Implementation order

1. Schema migration (`conventions`: `category`, `status`, `skillId`) +
   `db:generate` + `db:migrate`
2. `server/src/modules/conventions/` — repository → service → routes
   (extract, list, patch, promote), unit-tested
3. Client: `useConventions*` hooks, `/conventions` list page, `ConventionCard`
4. Client: create-skill modal + `modal` i18n namespace
5. API Contract Reviewer agent + 3 manual skills + 1 imported skill, linked
   in Agent Editor → Skills tab
6. Control experiment: real PR, skills-off run, skills-on run, compare

## 7. Open questions

- Should `POST /repos/:id/conventions/extract` be blocked while a previous
  extraction is still running for the same repo (avoid duplicate concurrent
  LLM calls)? Not addressed in this pass — flag if it becomes a real issue.
- `evidence` is single `{file, line}` per candidate in this pass. Multi-file
  evidence (raising confidence when a rule shows up in >1 sampled file) is a
  product improvement noted but out of scope for the first implementation.

## 8. Non-functional requirements

- **Cost.** Extraction makes one real LLM call per repo scan (12+ files of
  content in the prompt) — reuses `completeStructured`, so `costUsd`
  threading to `agent_runs` is inherited for free, same as the reviewer
  pipeline.
- **Grounding.** No candidate reaches the `conventions` table without a
  verified `file:line` — same trust posture as reviewer findings
  (`reviewer-core`'s `grounding.ts`), enforced in code, not by the model.
- **Tenant isolation.** Every `conventions`/repository method takes
  `workspaceId` explicitly, never inferred inside a query — same rule as
  `SkillsRepository`.
- **No execution.** Promoted skill bodies are plain markdown text, same
  "never executed, never rendered as HTML" guarantee as the rest of the
  Skills feature.

## Acceptance checklist

- [ ] `conventions` schema migration generated and applied
- [ ] Extraction produces grounded candidates only (ungrounded ones verified
      to be dropped, not silently kept)
- [ ] Accept/reject/edit works per candidate; re-scan doesn't duplicate
      already-promoted candidates
- [ ] Selected candidates promote into one real skill (`type: convention`,
      `source: extracted`), visible in `/skills`
- [ ] API Contract Reviewer agent exists with all 4 skills linked (3 manual
      + 1 imported via file)
- [ ] Skills-off run misses the breaking change; skills-on run flags it with
      a grounded citation
