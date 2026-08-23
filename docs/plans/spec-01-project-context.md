# Development Plan: SPEC-01 Project Context

Spec: [specs/SPEC-01-project-context.md](../../specs/SPEC-01-project-context.md)
(read in full; it is the authoritative requirements source — this plan does not
restate its ACs, it maps work items onto them).

## Objective

Make a repo's own Markdown documentation reachable by a review agent: discover
every `.md` file under configured search roots in the repo clone, show it with
a token estimate, let a user attach documents to a Skill or an Agent, and inject
the effective set at run time into the **already-existing** `PromptParts.specs`
prompt slot — the only prompt slot `run-executor.ts` never populates. The
outcome is a review that can say "this change contradicts `docs/adr/0003.md`".

## Scope

- **Packages/modules touched:** `server/` (new `modules/project-context/`,
  `modules/reviews/run-executor.ts`, `db/schema/`, `platform/config.ts`,
  `platform/container.ts`, `vendor/shared/contracts/`), `client/` (new
  `/repos/[repoId]/context` route, Skill + Agent Context tabs, trace rows,
  hooks, i18n, `vendor/shared/contracts/`, `vendor/ui/nav.ts`).
- **Execution mode:** **multi-agent (full handoff chain) — confirmed by the
  user.** `implementer` → `test-writer` → `plan-verifier` → `doc-writer`, each a
  separate invocation. Test authorship, spec/architecture verification and
  documentation therefore stay with the downstream agents and are **not** work
  items here; each work item's Definition of done names the test that must
  exist, so `test-writer` and `plan-verifier` can trace it, but writing it is
  their job.
- **Explicitly out of scope (feature-level, from the Spec's Non-goals):**
  `reviewer-core/**` (unchanged — no contract widening, no new prompt section);
  `code_chunks` / any chunking, embedding or retrieval pipeline; automatic
  PR-content-based document selection; in-app document editing; the "78
  COVERAGE" ring; `mcp/` pre-push CLI parity; cross-repo/workspace document
  libraries; community document catalogue.

## Constraints

Architectural rules that apply, each with the file that states them:

- **`reviewer-core` is untouched.** `PromptParts.specs`
  (`reviewer-core/src/prompt.ts:60-103`) and its render at `prompt.ts:142-145,165`
  already do everything needed. This is consumer-side wiring only — the exact
  treatment `run-executor.ts:228-237,242-268` already gave `skills`.
- **Onion architecture on the new module** (`onion-architecture` skill):
  `routes.ts → service.ts → repository.ts (port) ← repository.drizzle.ts`, no
  `db/client.ts` import from a service. `server/.dependency-cruiser.cjs` +
  `pnpm arch:check` enforce this on new `modules/*` code. Shape to copy:
  `server/src/modules/blast/` (`constants.ts`, `helpers.ts`, `repository.ts`,
  `repository.drizzle.ts`, `routes.ts`, `service.ts`).
- **Routes declare zod `params`/`body` schemas** — invalid input 422s before the
  handler (`server/AGENTS.md` § Non-default conventions). Never hand-roll
  `Schema.parse(req.body)`.
- **Workspace scoping on every read and write** via
  `getContext(app.container, req)` (`server/src/modules/_shared/context.ts`),
  passing `workspaceId` explicitly into the repository layer — the pattern
  `server/src/modules/agents/routes.ts:145-165` follows.
- **Do-not-touch paths, and how to route around them:**
  - `server/src/db/migrations/**` — never hand-edit; run `cd server && pnpm db:generate`.
  - `server/src/vendor/shared/**` and `client/src/vendor/shared/**` — a contract
    change is edited in one copy and **hand-mirrored byte-identically** into the
    other (root `AGENTS.md`; no sync script exists).
  - `client/src/vendor/ui/**` — do-not-touch per `client/AGENTS.md`. **One
    sanctioned exception**: `client/src/vendor/ui/nav.ts` is routing config, not
    design-system code (`client/INSIGHTS.md` § Codebase Patterns, confirmed
    three times: Skills, Conventions, the SKILLS LAB split). Adding the nav item
    is allowed but must be called out to the reviewer, not done silently. Every
    other `vendor/ui` file stays untouched — new client primitives go in
    `client/src/components/<name>/`.
  - `client/src/vendor/ui/primitives/Markdown.tsx` is the **only**
    `react-markdown` instance (`client/AGENTS.md`). Import it from the
    `@devdigest/ui` barrel; never add a second renderer, never
    `dangerouslySetInnerHTML`.
  - `specs/**` is human-authored. This feature reads it; nothing in this plan
    writes to it (WI13's rule document, if one is needed, goes under `docs/`).

Relevant INSIGHTS entries, cited:

- `client/INSIGHTS.md` § Codebase Patterns — "*A route's
  `client/messages/en/<feature>.json` can already encode the intended UX before
  any component exists*" **and** "*…can cover only part of a feature's flow*".
  Both apply hard here: `client/messages/en/context.json` already exists and is
  **stale relative to this Spec** (see `Recommendations` R-A).
- `client/INSIGHTS.md` § Codebase Patterns — `nav.ts` do-not-touch exception
  (above), plus `activeKeyFor` in
  `client/src/components/app-shell/helpers.ts:30` **already** maps
  `pathname.includes("/context") → "context"`; the nav key must be `context` or
  the highlight silently won't work.
- `server/INSIGHTS.md` § Tool & Library Notes — "*`adapters/tokenizer` is
  DI-generic, not repo-intel-only*". Calling `container.tokenizer.count()` from
  this module is a sanctioned use; do not invent a reviews→repo-intel dependency.
- `server/INSIGHTS.md` § Codebase Patterns — "*`RunTrace.specs_read` must only
  list paths opened this run*". Do not touch that field's population logic; the
  new project-context paths are a **separate** field (AC-27, D-2, ADR-0003).
- `server/INSIGHTS.md` § Recurring Errors & Fixes — `pnpm db:generate` prompts
  interactively when one run both drops and adds columns; this plan only ADDs, so
  it should stay prompt-free. If it prompts anyway, split into two pure-ADD runs.
- `server/INSIGHTS.md` § Recurring Errors & Fixes — `test/indexer-pipeline.test.ts`
  fails ~6 tests on this Windows environment for environmental reasons,
  unrelated to this work. Check `git status` on it before treating it as a
  regression.
- `server/INSIGHTS.md` § Recurring Errors & Fixes + § Session Notes (2026-08-09
  demo) — the local clone's refspec only ever fetches `main`, so a PR branch's
  head SHA must be fetched by hand (`git fetch origin <branch>`) before its diff
  loads; and clicking list **Refresh / resync restores `main` and drops the PR
  fixture**. Both bite WI13 directly.
- root `INSIGHTS.md` § Tool & Library Notes — `pnpm <script>` can abort with
  `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`; call the binary directly
  (`./node_modules/.bin/vitest` under Git Bash, `.\node_modules\.bin\vitest.cmd`
  under PowerShell). Also: Docker is not auto-started — `.it.test.ts` suites and
  WI13 need `docker ps` to work first.

## Recommendations

Concrete, act-or-reject. Each is a judgment this plan makes on top of the Spec.

- **R-A — `client/messages/en/context.json` is pre-authored but stale; the Spec
  wins, and the file must be rewritten, not extended.** It currently encodes the
  *old* design this Spec deliberately overrides: `"chunks": "{count} chunks"`
  (killed by D-4), `mode.edit` + `editor.save/saving` (killed by D-5),
  `empty.body` telling the user to "*Drop your PRDs … under `.devdigest/specs/`*"
  (killed by D-3's `specs/`, `docs/`, `insights/`), and `reindex`/`indexStatus`
  keys implying an indexing pipeline that does not exist for documents. Per
  `client/INSIGHTS.md`, pre-authored copy is normally *more* authoritative than a
  spec inferred from prose — that rule does **not** apply here, because SPEC-01
  is an explicit, user-approved decision record (D-3/D-4/D-5) that post-dates the
  scaffolding. WI9 rewrites the namespace. Flagging it because silently keeping
  `chunks`/`edit` keys would ship a UI contradicting the Spec.
- **R-B — the stale `SpecFile` contract and `useContextFiles` hook are
  scaffolding for this feature and should be replaced in place, not left
  beside a parallel new contract.** `SpecFile` (`{path, content?, size?,
  updated_at?}`, `*/src/vendor/shared/contracts/platform.ts:250-256`) and
  `useContextFiles`/`useReindexContext` (`client/src/lib/hooks/core.ts:122-137`,
  calling `GET /repos/:id/context`, a route that **does not exist** on the
  server — verified against `server/src/modules/index.ts`) are dead today. Reuse
  the `/repos/:repoId/context` path and delete `useReindexContext` outright
  (there is no re-index step in this feature — D-4/Non-goals). Leaving two
  document contracts alive is exactly the drift `AGENTS.md` already warns about
  for hand-mirrored vendor files.
- **R-C — resolve the Spec's open questions as follows** (Q4/Q7/Q8/Q9/Q10),
  each anchored on an in-repo precedent rather than a guessed number:
  - **Q10 (where config lives) — split by kind.** Search **roots** go in
    `AppConfig` as env-backed `PROJECT_CONTEXT_ROOTS` (default
    `specs,docs,insights`), following `DEVDIGEST_CLONE_DIR`
    (`server/src/platform/config.ts:36,78-80`) — D-3 calls them "a server config
    value", i.e. deployment-changeable without a code edit. Engineering **caps**
    go in `server/src/modules/project-context/constants.ts`, following
    `server/src/modules/repo-intel/constants.ts:14-53` (`SUPPORTED_EXT`,
    `MAX_FILE_SIZE`, `DEFAULT_REPO_MAP_TOKEN_BUDGET` all live there). The
    documented default glob stays `**/{specs,docs,insights}/**/*.md`.
  - **Q7 (numbers) — four constants, each derived from an existing one:**
    `MAX_DOC_FILE_BYTES = 256 * 1024` (below repo-intel's `MAX_FILE_SIZE` 400 KB,
    `walk.ts:8`, because a doc's *whole* text is billed to the LLM, not parsed
    and discarded); `MAX_DISCOVERED_DOCS = 2000` (below `MAX_INDEXED_FILES` 5000,
    `walk.ts:10` — three roots of `.md` is a far smaller set than a whole repo);
    `MAX_DOC_CHARS = 20_000` per injected document (exactly
    `MAX_SPEC_FILE_CHARS`, `intent-service.ts:50`, so the two spec-reading paths
    truncate identically); `PROJECT_CONTEXT_TOKEN_BUDGET = 8000` (vs
    `DEFAULT_REPO_MAP_TOKEN_BUDGET` 1500, `repo-intel/constants.ts:51` — the
    project-context slot is user-chosen and is the feature's whole point, so it
    gets the larger share, while still bounding a 5-PRD attachment). No page-load
    latency SLO is proposed: nothing in this repo defines one for any endpoint,
    and inventing one would be unmeasurable. The Performance NFR is instead met
    structurally by the walk bound + the `MAX_DOC_FILE_BYTES` read cap.
  - **Q4 (E-8 repo scoping) — as the Spec proposes.** Attachments store
    `repo_id`; at run time only documents whose `repo_id` equals the PR's repo are
    resolved, and each mismatch emits a run-log line. Attachment is *not* refused
    at write time — an agent is workspace-scoped and may legitimately be attached
    to documents of several repos.
  - **Q8 (gitignored docs) — do not honour `.gitignore` this iteration; mitigate
    instead.** `walk.ts:14-19` documents the same gap and the same reason (it
    needs the `ignore` npm dep or a `git ls-files` shell-out). Mitigations that
    *are* in scope: reuse `EXCLUDED_DIRS` (`repo-intel/constants.ts:17-26`) so
    `node_modules`/`dist`/`.git` never appear, and render the A04 outbound-data
    warning at both attach surfaces (AC/UX-7). Recorded as an accepted risk (R-4),
    not silently dropped.
  - **Q9 (coverage ring) — stays a Non-goal.** No work item. Nothing in this repo
    defines a coverage denominator; building one is a separate feature.
- **R-D — one polymorphic attachment table, with the FK tradeoff stated up
  front.** The Spec fixes the key as `(surface, surface_id, repo_id, path)`,
  which cannot carry a real foreign key on `surface_id` (it points at `skills.id`
  *or* `agents.id`). The `postgresql-table-design` skill prefers a real FK, and
  the two-table alternative (`skill_context_docs` + `agent_context_docs`,
  mirroring `agent_skills`) would give one — at the cost of duplicating every
  query. **Recommendation: keep the single table per the Spec**, and compensate:
  (a) `repo_id` and `workspace_id` do get real FKs with `onDelete: 'cascade'`;
  (b) `AgentsService.delete` / `SkillsService.delete` explicitly delete that
  surface's attachment rows; (c) every read joins through an
  already-authorized agent/skill, so an orphan row can never be returned. Reject
  this and you get two tables and a duplicated effective-set query — say so before
  implementation starts, not after the migration exists.
- **R-E — sequence server-before-client, and land WI1 (contracts) first.** Both
  packages consume the same hand-mirrored contract file; if the client is built
  against a guessed shape, the mirror drifts and nothing catches it (root
  `INSIGHTS.md` § Codebase Patterns: "*real drift risk … with no tooling to catch
  it*"). WI1 → WI2 → WI3-7 (server) → WI8-12 (client) → WI13 (live grounding).

## Work items

### WI1 — Contracts (both vendor mirrors)

1. Add the Project Context contracts and the new trace field; retire the stale
   `SpecFile` shape (R-B).
   - **Files/modules:** `server/src/vendor/shared/contracts/platform.ts`
     (replace `SpecFile` at :250-256 with `ContextDocument`),
     `server/src/vendor/shared/contracts/trace.ts` (add
     `RunTrace.project_context_docs`), then **hand-mirror both files
     byte-identically** into `client/src/vendor/shared/contracts/`.
     Re-export via `client/src/lib/types.ts:30` (currently exports `SpecFile`).
   - **Shapes:**
     - `ContextDocument = { path, source_folder, type, tokens, bytes, missing }`
       — `path` repo-relative, `tokens` an estimate (AC-2), `missing` true for an
       attached-but-absent file (E-2).
     - `ContextListing = { documents: ContextDocument[], total_tokens, total_files, degraded_reason: string|null }`
       — `degraded_reason` non-null carries the no-clone case (AC-3/E-1).
     - `ContextAttachment = { path, order }`; `ContextAttachmentSet = { repo_id, documents: ContextAttachment[], total_tokens }`.
     - `SetContextBody = { repo_id, paths: string[] }` (replace semantics).
     - `RunTrace.project_context_docs: z.array(z.object({ path: z.string(), tokens: z.number().int(), chars: z.number().int() })).default([])`
       — **must** have `.default([])`: `RunTrace` is parsed back out of
       `run_traces` jsonb, and a required field would break every trace written
       before this feature (`trace.ts:74-92`).
   - **Unchanged, deliberately:** `PromptAssembly.specs` (`trace.ts:39-55`) and
     `RunTrace.specs_read` (`trace.ts:88-89`) keep their current definition and
     docblock meaning (AC-27, D-2, ADR-0003).
   - **Applicable skills:** `zod`, `typescript-expert`.
   - **Definition of done:** both vendor copies are byte-identical (verify with
     a diff), `cd server && pnpm typecheck` and `cd client && pnpm typecheck`
     both clean, and no remaining reference to `SpecFile` anywhere
     (`git grep SpecFile` returns only the mirrored comment headers, which stay
     as-is per `server/INSIGHTS.md`'s "don't widen vendor comment drift" note).

### WI2 — DB schema + migration

2. Add the attachment table (AC-9, AC-10, AC-13, E-8; R-D).
   - **Files/modules:** new `server/src/db/schema/project-context.ts`, exported
     from `server/src/db/schema.ts` (follow the existing `export * from
     './schema/…'` block at :22 and the import list at :36).
   - **Table `project_context_attachments`:** `id` uuid pk;
     `workspace_id` uuid not null → `workspaces.id` cascade (A01 tenant
     isolation); `repo_id` uuid not null → `repos.id` cascade;
     `surface` text enum `['skill','agent']` not null; `surface_id` uuid not null
     (**no FK** — polymorphic, see R-D); `path` text not null; `order` integer
     not null default 0; `created_at` via the shared `now()` helper
     (`server/src/db/schema/_shared.ts`). Indexes: unique on
     `(surface, surface_id, repo_id, path)` (the Spec's stated key, and what makes
     re-attach idempotent), plus a non-unique index on `(repo_id)` for the AC-8
     "Used by N agents" count.
   - **Explicitly NOT used:** `code_chunks` (`server/src/db/schema/context.ts:31-47`)
     — it implies chunking + `vector` embeddings this feature rejects (Non-goals).
   - **Migration:** generate only — `cd server && pnpm db:generate`, then
     `pnpm db:migrate`. Never hand-edit `src/db/migrations/**`.
   - **Applicable skills:** `drizzle-orm-patterns`, `postgresql-table-design`.
   - **Definition of done:** one new pure-ADD migration file exists under
     `server/src/db/migrations/`, `pnpm db:migrate` applies clean against the
     local Postgres, and `pnpm typecheck` is clean.

### WI3 — Config + constants + bounded recursive discovery

3. Add the module skeleton, its configuration, and the guarded walk
   (AC-1, AC-3, AC-5, E-3, E-9, E-10, E-14, E-15, E-16).
   - **Files/modules:** new `server/src/modules/project-context/constants.ts`
     and `discover.ts`; `server/src/platform/config.ts` (add
     `PROJECT_CONTEXT_ROOTS` to `EnvSchema` and `projectContextRoots: string[]`
     to `AppConfig`, following `DEVDIGEST_CLONE_DIR` at :36,78-80).
   - **Constants (R-C/Q7):** `MAX_DOC_FILE_BYTES = 256 * 1024`,
     `MAX_DISCOVERED_DOCS = 2000`, `MAX_DOC_CHARS = 20_000`,
     `PROJECT_CONTEXT_TOKEN_BUDGET = 8000`, `DOC_EXT = '.md'`,
     `DEFAULT_CONTEXT_ROOTS = ['specs','docs','insights']`. Reuse
     `EXCLUDED_DIRS` by importing it from `modules/repo-intel/constants.ts`
     rather than re-declaring it.
   - **`discover.ts`:** a pure-ish recursive walk modelled on
     `server/src/modules/repo-intel/pipeline/walk.ts:55-71` — same
     `readdir`/`stat` shape, same "sort for stable order, then bound" ending,
     same `stats` return. Differences: it starts from each configured root
     (a root absent from the repo contributes nothing and must not throw — E-16),
     filters on `.md`, and **every** resolved path — directory entries included —
     goes through `isInsideClone(clonePath, relPath)`
     (`server/src/modules/reviews/intent-inputs.ts:138`) before any `stat`/read,
     so a symlink escaping the clone is dropped (E-10). Returns metadata only
     (path, source folder, bytes) — content is read on demand (AC-5: no cached
     body is ever served as current).
   - **Applicable skills:** `security` (path traversal / symlink escape / DoS
     bounds), `typescript-expert`.
   - **Definition of done:** a unit test over a temp fixture clone proves: a
     nested `docs/adr/0001-x.md` is found (AC-1), a missing `insights/` root is a
     no-op (E-16), a zero-`.md` clone returns an empty set without error (E-14),
     a file above `MAX_DOC_FILE_BYTES` is excluded, and a symlink pointing
     outside the clone is excluded (E-10). `pnpm arch:check` stays clean.

### WI4 — Attachment repository (port + adapter)

4. Persist and read attachments, workspace-scoped (AC-9, AC-10, AC-13, AC-16, A01).
   - **Files/modules:** new `server/src/modules/project-context/repository.ts`
     (interface) and `repository.drizzle.ts` (impl); register a lazy cached
     getter `contextRepo` in `server/src/platform/container.ts` next to
     `blastRepo` (:130-132) and add the override slot to `ContainerOverrides`.
   - **Port methods:** `listFor(workspaceId, surface, surfaceId)`,
     `replaceFor(workspaceId, surface, surfaceId, repoId, paths)` (delete +
     insert in order, so AC-13 ordering is the array index),
     `listForAgentEffective(workspaceId, agentId, repoId)` (agent-direct ∪
     enabled-skill-attached — one query joining `agent_skills` → `skills` with
     `skills.enabled = true`, mirroring the enabled-only rule at
     `run-executor.ts:228-229`), `usageCountsByPath(workspaceId, repoId)` for
     AC-8, and `deleteForSurface(workspaceId, surface, surfaceId)` for R-D(b).
   - **Every method takes `workspaceId` explicitly** and filters on it — attaching
     a document of repo A to an agent of workspace B must 404, not succeed (A01).
   - **Applicable skills:** `drizzle-orm-patterns`, `onion-architecture`,
     `security` (A01 tenant isolation).
   - **Definition of done:** integration test (`.it.test.ts`, real Postgres)
     covering: replace-set persists order; a second workspace's ids return
     nothing; the effective query excludes a disabled skill's documents (AC-15)
     and includes an enabled one's (AC-14 dedupe is asserted in WI5).

### WI5 — Service: listing, attachment, effective set

5. Compose discovery + tokenizer + attachments into the read/write/resolve
   surface (AC-2, AC-3, AC-5, AC-8, AC-12, AC-14, AC-15, AC-17, AC-22, E-1, E-2,
   E-4, E-5, E-6, E-7, E-11).
   - **Files/modules:** new `server/src/modules/project-context/service.ts` and
     `helpers.ts`.
   - **`listDocuments(workspaceId, repoId)`:** load the repo row; if
     `repos.clone_path` is null return an empty listing with a
     `degraded_reason` — never an error (AC-3/E-1, same degradation as
     `intent-service.ts:215-219`). Otherwise walk (WI3), read each file capped at
     `MAX_DOC_FILE_BYTES`, count tokens via `container.tokenizer.count()`
     (`server/src/adapters/tokenizer/index.ts`; DI-generic per
     `server/INSIGHTS.md`), merge `usageCountsByPath` for `used_by_agents`
     (AC-8), and mark attached-but-absent paths `missing: true` (E-2). Never
     cache bodies (AC-5).
   - **`resolveEffectiveSet(workspaceId, agentId, repoId)`:** union agent-direct
     with enabled-skill-attached, **dedupe by `path`** keeping the lowest order
     (AC-14, D-1, E-6), read each document fresh from disk at that moment
     (AC-17), skip unreadable/deleted/binary files returning a `skipped[]` list
     (AC-20, E-2, E-5), skip whitespace-only files so no empty `<untrusted>`
     entry is emitted (E-4), truncate each body at `MAX_DOC_CHARS`, then walk the
     ordered list accumulating tokens until `PROJECT_CONTEXT_TOKEN_BUDGET` is
     reached and return the remainder as `truncated[]` (AC-22). Returns
     `{ entries: {path, text, tokens, chars}[], skipped: string[], truncated: string[] }`.
   - **Entry text format (AC-19):** each entry's text begins with its
     repo-relative path on its own line, *inside* the block that
     `wrapUntrusted` will wrap — the path must be traceable from the assembled
     prompt, and it must not sit in a trusted position (the same correction
     `server/INSIGHTS.md` records for the intent classifier's spec header).
   - **AC-12/E-7 consistency:** the token totals the Context tabs display come
     from this same enabled-only, deduped resolution — not from a naive sum over
     attachment rows, which would overstate cost.
   - **Applicable skills:** `onion-architecture`, `typescript-expert`,
     `security` (A06 size/DoS caps, A09 log paths and sizes never content).
   - **Definition of done:** unit tests with a stub `Tokenizer` and a temp clone
     prove AC-2, AC-14 (one occurrence), AC-15 (disabled skill contributes
     nothing), AC-22 (low budget → correct `truncated[]`), E-4 (whitespace-only
     dropped), E-5 (binary skipped, no throw).

### WI6 — Routes + module registration

6. Expose the HTTP surface (AC-1, AC-3, AC-4, AC-9, AC-10, AC-11, AC-16, A01).
   - **Files/modules:** new `server/src/modules/project-context/routes.ts`;
     one import + one entry in `server/src/modules/index.ts:1-40`.
   - **Endpoints** (all resolve `getContext(app.container, req)` first, all with
     zod `params`/`body` schemas):
     - `GET /repos/:repoId/context` → `ContextListing` (reuses the path the dead
       client hook already assumes, R-B).
     - `GET /repos/:repoId/context/document?path=…` → `{ path, content }` for the
       preview (AC-4). **`path` is attacker-controlled**: resolve via
       `isInsideClone` and 400 on escape before any `readFile` — never
       `path.join(clonePath, req.query.path)` (AC-16, E-10).
     - `GET /skills/:id/context`, `POST /skills/:id/context` (replace set)
       (AC-9); `GET /agents/:id/context`, `POST /agents/:id/context` (AC-10).
       `POST` mirrors the set-or-link shape of `POST /agents/:id/skills`
       (`server/src/modules/agents/routes.ts:152-165`); body is `SetContextBody`.
       Every path in the body passes `isInsideClone` and the whole request is
       rejected 4xx with **nothing persisted** if any path escapes (AC-16).
     - 404 (not 200-with-empty) when the skill/agent doesn't belong to the
       caller's workspace (A01).
   - **Also:** call `contextRepo.deleteForSurface` from `AgentsService.delete`
     and `SkillsService.delete` (R-D(b)).
   - **Applicable skills:** `fastify-best-practices`, `zod`, `security`
     (A01, A05 path injection), `onion-architecture`.
   - **Definition of done:** `.it.test.ts` proving AC-1 against a fixture clone
     with a nested `docs/adr/0001-x.md`, AC-3 with `clone_path` null, AC-9/AC-10
     round-trips (and that attaching on an agent leaves `agent_skills` untouched),
     AC-16 with a `../../etc/passwd` path (4xx **and** zero rows written), and a
     cross-workspace 404. `pnpm arch:check` clean.

### WI7 — Run-executor wiring + trace + run-log lines

7. Populate the one prompt slot nothing populates (AC-17 – AC-22, AC-26, AC-27,
   AC-28, E-8).
   - **Files/modules:** `server/src/modules/reviews/run-executor.ts` only.
   - **Where:** build the effective set next to the skills block
     (`run-executor.ts:228-237`) — best-effort in a try/catch that logs and
     returns `undefined`, exactly like `buildCallersDigest`/`buildRepoMapDigest`
     (`:401-431`, `:438-451`), so a failure never fails the run (AC-20,
     Availability NFR). Pass `pull.repoId` as the repo scope, so an agent
     attached to another repo's documents contributes nothing here and each
     mismatch is one run-log line (E-8, R-C/Q4).
   - **What:** add `...(specs ? { specs } : {})` to the `reviewPullRequest({…})`
     call at `:242-268` — the same omit-when-empty spread as `callers`/`repoMap`/
     `skills`. Empty set ⇒ the key is absent ⇒ the assembled prompt is
     byte-identical to today (AC-21, the same guarantee `prompt.ts:92-96` states
     for `intent`).
   - **Run-log lines (A09 — paths and sizes only, never content):** one line per
     skipped document naming its path (AC-20), one per budget-truncated document
     (AC-22), one summary line ("N document(s) attached — ≈X tokens").
   - **Trace:** set `project_context_docs` on the success-path `RunTrace`
     (`:324-354`) from the resolved entries — path + tokens + chars per document
     (AC-26). Leave `specs_read` populated exactly as today from
     `specPathsFrom` (AC-27, D-2). On the failure/cancel path,
     `traceFromBuffer` (`:482-507`) keeps `specs: null` and gets
     `project_context_docs: []` (AC-28).
   - **Applicable skills:** `security` (A05 — text reaches the model only via
     `PromptParts.specs`, never bespoke concatenation; A09 logging),
     `typescript-expert`.
   - **Definition of done:** unit test on the assembled `PromptParts` proving
     AC-18 (`specs` populated), AC-19 (each entry's path present in the assembled
     string inside the `<untrusted>` block), AC-21 (empty set ⇒ prompt string
     identical to the no-project-context baseline); `.it.test.ts` proving AC-20
     (deleted file → run completes, log line names the path), AC-22, AC-26
     (one trace entry per injected document, non-null size), AC-28 (failed run's
     trace has `specs: null` and no project-context claim). `reviewer-core`
     source is untouched — verify with `git diff --stat reviewer-core/`.

### WI8 — Client data layer

8. Replace the dead hooks with real ones (R-B).
   - **Files/modules:** new `client/src/lib/hooks/context.ts` (follow
     `client/src/lib/hooks/blast.ts` / `conventions.ts`); delete
     `useContextFiles` and `useReindexContext` from
     `client/src/lib/hooks/core.ts:122-137`; export from
     `client/src/lib/hooks/index.ts`.
   - **Hooks:** `useContextDocuments(repoId)`, `useContextDocument(repoId, path)`
     (lazy, `enabled` by selection — the same lazy pattern as
     `usePrLatestFindings`), `useSkillContext(skillId)` /
     `useSetSkillContext()`, `useAgentContext(agentId)` /
     `useSetAgentContext()`. All go through `src/lib/api.ts`; no component ever
     calls `fetch` (`client/AGENTS.md`).
   - **Applicable skills:** `react-best-practices`, `react-project-structure`,
     `typescript-expert`.
   - **Definition of done:** `cd client && pnpm typecheck` clean; no remaining
     import of the deleted hooks (`git grep useContextFiles`).

### WI9 — Project Context page + nav + i18n

9. The standalone repo-scoped page (AC-1, AC-4, AC-6, AC-7, AC-8, E-1, E-2,
   E-11, E-12, E-13, E-14; UX-1, UX-2, UX-6, UX-8, UX-11).
   - **Files/modules:** new `client/src/app/repos/[repoId]/context/page.tsx` +
     `_components/ProjectContextView/` (folder shape copied from
     `client/src/app/repos/[repoId]/conventions/_components/ConventionsListView/`:
     `<Name>.tsx`, `index.ts`, `styles.ts`, optional `helpers.ts`); rewrite
     `client/messages/en/context.json` (R-A).
   - **UI:** master list (repo-relative path, source-folder tag, type, `≈N
     tokens`, "Used by N agents") + search/filter box + read-only preview panel
     rendered through the `@devdigest/ui` `Markdown` primitive **only** (A05 XSS).
     Header summary reads exactly `"N files indexed · ≈X tokens"` (AC-6), and
     reflects the filtered/selected subset when one is active (AC-7). Token
     numbers are always prefixed `≈` and labelled an estimate (UX-6, E-11).
     Three empty/missing states — no clone (E-1), zero documents (E-14),
     attached-but-missing document badge (E-2) — none of which the design
     covers (UX-8).
   - **i18n keys to drop:** `chunks`, `reindex`, `indexing`, `resync`,
     `resyncing`, `indexStatus`, `mode.edit`, `editor.*`. Keys to add: the
     summary line, search placeholder, source-folder/type labels, `usedByAgents`,
     the three empty states, the outbound-data notice. `empty.body` must stop
     naming `.devdigest/specs/` and name `specs/`, `docs/`, `insights/` (D-3).
   - **Nav (E-13, do-not-touch exception):** add
     `{ key: "context", label: "Project Context", icon: <IconName>,
     href: "/repos/:repoId/context", gKey: "x" }` to `client/src/vendor/ui/nav.ts`
     — repo-scoped and `:repoId`-templated like `conventions` at :33-39 — plus
     the matching `SHORTCUTS` entry at :64-74. The key **must** be `context`
     to match the already-wired `activeKeyFor`
     (`client/src/components/app-shell/helpers.ts:30`). Pick a `gKey` not
     already taken (`p`, `a`, `s`, `c`, `,` are used). Call this vendor edit out
     explicitly in the implementer's report.
   - **Applicable skills:** `next-best-practices`, `react-project-structure`,
     `react-best-practices`, `security` (A05 XSS — centralized Markdown only).
   - **Definition of done:** component tests with a stubbed listing prove AC-6
     (summary text incl. "files indexed", no chunk count anywhere), AC-7
     (filter narrows the summary), AC-4 (selecting renders the preview), and the
     E-14 zero state. `client/src/test/smoke.test.tsx` still passes (it mounts
     `/showcase` and breaks on any vendored-component regression).

### WI10 — Skill Context tab

10. Attach documents to a Skill (AC-9, AC-11, AC-12, AC-13; UX-3, UX-7, E-12).
    - **Files/modules:** new
      `client/src/app/skills/_components/SkillPreview/_components/ContextTab/`
      — a third tab beside `OverviewTab` and `VersionHistoryTab`, registered in
      `SkillPreview.tsx`; keys added to `client/messages/en/skills.json`.
    - **UI:** searchable document list with path + type + `≈tokens` (AC-11 — a
      flat scrollable list is not acceptable, recursive discovery makes hundreds
      of rows normal), checkbox attach/detach, drag-to-reorder (reuse the
      ordering interaction already built in
      `client/src/app/agents/[id]/_components/AgentEditor/_components/SkillsTab/`),
      per-document preview via the same `Markdown` primitive, an attached-set
      total (`≈X tokens`, AC-12), the inheritance note ("Any agent using this
      skill inherits these documents"), and the outbound-data notice: attaching
      sends the document to the model provider on every run of every inheriting
      agent (UX-7 / NFR A04). Any "serializes as" hint must say
      **`## Project context`** — the string `prompt.ts:165` actually emits (E-12,
      UX-1).
    - **Applicable skills:** `react-best-practices`, `react-project-structure`,
      `react-testing-library`, `security` (A05 XSS).
    - **Definition of done:** component test types a query and asserts the list
      narrows **while already-attached non-matching rows stay attached** (AC-11's
      exact wording), and asserts the attached-set token total renders.

### WI11 — Agent Context tab

11. Attach documents directly to an Agent, with inherited-vs-direct made visible
    (AC-10, AC-11, AC-12, AC-13, E-7, E-8; UX-4, UX-5).
    - **Files/modules:** new
      `client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/`
      — a third tab beside `ConfigTab`/`SkillsTab`, registered in
      `AgentEditor.tsx`; keys added to `client/messages/en/agents.json`.
    - **Two visually distinct groups** (UX-4): documents **inherited** from the
      agent's enabled linked skills (read-only here, each labelled with the skill
      it comes from) and documents attached **directly** (editable). Without this
      the token total and the effect of unchecking are unexplainable.
    - **Enabled-only everywhere** (UX-5, E-7): a disabled skill's documents are
      neither listed as inherited nor counted in the total — the same rule the
      run applies (AC-15).
    - **Repo scope (E-8):** the document list is the **active repo's** (from
      `client/src/lib/repo-context.tsx`), and the saved attachment carries that
      `repo_id`. Show, don't hide, attachments belonging to other repos of the
      workspace, marked as "not injected for runs on this repo".
    - Same search box, preview, token total and outbound-data notice as WI10.
    - **Applicable skills:** `react-best-practices`, `react-project-structure`,
      `react-testing-library`.
    - **Definition of done:** component test asserts inherited and direct
      documents render in separate groups, a disabled skill's document appears in
      neither and is excluded from the total (E-7), and `AgentEditor.test.tsx`
      still passes with the new tab present.

### WI12 — Run trace: label, per-document rows, Configuration row

12. Make the injected set inspectable (AC-25, AC-26, AC-27; UX-9, UX-10).
    - **Files/modules:**
      `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/_components/TraceBody/TraceBody.tsx`
      and `client/messages/en/runs.json`.
    - **AC-25:** the `prompt_assembly.specs` `PromptBlock` already renders
      (`TraceBody.tsx:85-87`); only the label changes — `runs.json`
      `trace.prompt.specs` goes from `"Project context (dynamic)"` to
      `"Project context — attached specs (untrusted)"`. **Reuse `PromptBlock`**
      (`TraceBody.tsx:74-94`), do not introduce a second viewer (UX-10).
    - **AC-26:** a per-document path + size list rendered with the existing
      Configuration-panel `Row` pattern (`TraceBody.tsx:36-51`), fed by the new
      `trace.project_context_docs` — so a reader can tell which of five documents
      cost the most (UX-9).
    - **AC-27:** that list is a **row distinct** from the existing "Specs read"
      row (`TraceBody.tsx:39-51`, fed by `trace.specs_read`), with its own label
      in `runs.json` `trace.config.*`. The two must never be merged
      (ADR-0003 explicitly warns against it).
    - **Applicable skills:** `react-best-practices`, `react-testing-library`.
    - **Definition of done:** component test with a fixture `RunTrace` asserts
      both rows render from **different** fields and that a trace with
      `project_context_docs: []` (an old trace) renders without throwing.

### WI13 — Live grounding verification on PR #3 (AC-24)

13. Prove grounding with a **real, end-to-end review against a real GitHub PR** —
    not a mocked or stubbed LLM call. Scope confirmed by the user: a guaranteed
    live result, not a best-effort attempt.
    - **Fixture PR (user-supplied):**
      `https://github.com/AneliiaOleksiuk/dev-digest/pull/3` — the repo's existing
      real test PR (the `rateLimit` blast-radius demo, `server/INSIGHTS.md`
      2026-08-09). No from-scratch synthetic `pull_requests`/`pr_files` fixture is
      needed on top of it: the synthetic path
      (`server/INSIGHTS.md` § What Works) exists only to work around a PR whose
      diff won't load, and PR #3's already does once its head SHA is fetched.
    - **Approval gate — before anything is pushed.** This item adds a commit to
      a real, shared GitHub PR branch, i.e. state visible to others. `implementer`
      must show the exact intended diff and obtain **explicit user confirmation
      before `git push`**. Committing locally is fine; pushing without that
      confirmation is not. Target `origin` (`AneliiaOleksiuk/dev-digest`) only —
      never the upstream course repo.
    - **Rule + document to violate.** Prefer a rule that is *already documented*
      under a configured discovery root (`specs/`, `docs/`, `insights/`), so no
      new document has to be authored:
      - **First choice —** `docs/adr/0003-specs-read-reuse-for-intent.md`, whose
        rule ("`RunTrace.specs_read` is paths only, never contents", also stated
        at `run-executor.ts:120-125`) is real, crisp, and violable in a single
        hunk that writes spec *text* into that field.
      - **Fallback —** the Spec's own reference case (AC-24): add a short rule
        document under **`docs/`** stating "the `api/` module must not import
        `db/` directly", and add exactly such an import in the commit. The rule
        document goes under `docs/`, never `specs/` — `specs/` is human-authored
        and out of every agent's write scope.
      Either way the document must be discoverable by WI3's walker; a rule that
      only lives in `.claude/skills/**` or in `AGENTS.md` is **not** (those paths
      are outside the configured roots), so don't pick one of those.
    - **Steps:** (1) commit the violation on PR #3's branch, push **after
      approval**; (2) sync it into DevDigest (`POST /repos/:id/poll`) and make the
      head SHA loadable in the local clone — the clone's refspec only fetches
      `main`, so `git fetch origin <branch>` inside the clone dir is required, and
      `git cat-file -t <sha>` is the check; **never** click list Refresh /
      resync, which restores `main` and drops the PR fixture (both from
      `server/INSIGHTS.md`); (3) attach the rule document to the reviewing agent
      **through the new Agent Context tab / attachment API this Spec builds**
      (WI6/WI11) — not by hand-inserting a DB row, since exercising the feature is
      half the point; (4) run a normal review (`POST /pulls/:id/review`) against a
      real provider; (5) read the persisted run trace.
    - **Control run (AC-24's second half):** detach the document, re-run the same
      PR, record that the reference is absent or unreferenced. Same two-run
      control shape as `specs/skills-feature.md` §4. Persist both runs as
      `eval_cases` + `eval_runs` rows (`server/src/db/schema/eval.ts:7,22` — the
      tables already exist) so the result is reviewable later instead of being a
      claim in a chat log. Set a realistic expectation from
      `server/INSIGHTS.md` § What Doesn't Work: a modern model may already flag an
      *obvious* violation without the document, so the measured contrast may be
      precision (naming the document/rule) rather than catch-vs-miss — AC-24 asks
      for a rationale that **references the document's path**, which is the right
      assertion either way.
    - **Environment dependency — a hard prerequisite for "done", not a caveat:**
      Docker/Postgres running **and** a working LLM provider key at execution
      time. Check `docker ps` and `POST /settings/test-connection` per provider
      *before* starting; if a provider is exhausted, reroute this feature's model
      via `Settings.feature_models` rather than debugging it as a code bug
      (`server/INSIGHTS.md` 2026-08-02, where OpenAI and Anthropic were both dead
      and only OpenRouter worked). See R-3.
    - **Applicable skills:** `drizzle-orm-patterns` (the `eval_cases`/`eval_runs`
      rows), `security` (A09 — record paths and sizes, never document content).
    - **Definition of done — all five required, none opportunistic:**
      (a) explicit user approval obtained before the push to PR #3's branch;
      (b) a real (non-mocked) review run against PR #3 completes, and at least one
      finding's rationale references the attached document's repo-relative path
      (AC-24);
      (c) that run's trace shows the same path inside the `## Project context`
      block and a matching `project_context_docs` entry (AC-19, AC-26);
      (d) the control run with the document detached is executed and recorded;
      (e) both runs are persisted as `eval_runs` rows linked to one `eval_cases`
      row.
      A blocked environment makes this a **blocked work item**, reported as
      blocked — it is no longer grounds for marking AC-24 done.
    - **Watch out:** if the fallback "`api/` must not import `db/`" variant is
      used and the violating import lands under `server/src/modules/*`, it will
      trip `pnpm arch:check`. That is expected **on PR #3's branch only** — never
      merge that commit, and run the Test plan commands from the working branch,
      not from the PR tip.

## Test plan

Commands exactly as each package's AGENTS.md states them:

- **server** (`server/AGENTS.md` — the test split is deliberately *not* in
  `package.json` and must be typed out):
  - `cd server && pnpm typecheck`
  - `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` (unit)
  - `cd server && pnpm exec vitest run .it.test` (integration — **needs Docker
    Postgres up**; check `docker ps` first, per root `INSIGHTS.md`)
  - `cd server && pnpm arch:check` (dependency-cruiser onion boundary check —
    required because WI3–WI6 add a new `modules/*` folder). Run it from the
    working branch, not from PR #3's tip (see WI13's "Watch out").
  - `cd server && pnpm db:generate` then `pnpm db:migrate` (WI2 only)
- **client** (`client/AGENTS.md`):
  - `cd client && pnpm typecheck`
  - `cd client && pnpm test` — **bare `pnpm test`**, never `pnpm test run`
    (`client/INSIGHTS.md`: the extra arg silently narrows the suite to files
    whose path contains "run" and still exits green)
- **reviewer-core** (`reviewer-core/AGENTS.md`; npm, not pnpm):
  - `cd reviewer-core && npm test` — a regression guard, not a change target.
    Combined with `git diff --stat reviewer-core/` returning empty, this is the
    evidence for the "reviewer-core is unchanged" constraint.
- **WI13 (live, manual)** — not a suite command: `docker ps`,
  `POST /settings/test-connection`, `git fetch origin <branch>` +
  `git cat-file -t <sha>` in the clone, `POST /repos/:id/poll`,
  `POST /pulls/:id/review`, then read the run trace. Evidence goes in the
  implementer's report, and in `eval_runs`.
- **Windows fallback** if any `pnpm <script>` aborts with
  `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`: call the binary directly —
  `./node_modules/.bin/vitest run` / `./node_modules/.bin/tsc --noEmit` under the
  Bash tool, `.\node_modules\.bin\vitest.cmd` under PowerShell (root
  `INSIGHTS.md` § Tool & Library Notes).

## Risks / Open questions

- **R-1 — RESOLVED.** Execution mode confirmed by the user: **multi-agent**
  (`implementer` → `test-writer` → `plan-verifier` → `doc-writer`). The
  single-agent fallback work items that previously sat at the end of `Work
  items` have been removed; tests and verification belong to the downstream
  agents.
- **R-2 — RESOLVED.** AC-24 scope confirmed by the user: a **guaranteed live
  result** against the existing real PR
  `https://github.com/AneliiaOleksiuk/dev-digest/pull/3`, not the opportunistic
  fallback. WI13 is rewritten accordingly, and a blocked environment now makes
  WI13 blocked rather than done.
- **R-3 — Docker and provider-key availability are a HARD BLOCKER for WI13**
  (upgraded from a soft risk by R-2's decision). Docker is not auto-started in
  this environment (root `INSIGHTS.md`), and this repo has already hit exhausted
  OpenAI **and** Anthropic keys with only OpenRouter working
  (`server/INSIGHTS.md` 2026-08-02). Check `docker ps` and
  `POST /settings/test-connection` before starting WI13; reroute via
  `Settings.feature_models` if needed. `implementer` must never report AC-24 met
  on the strength of an unrun review.
- **R-4 — gitignored documents remain visible and attachable (E-9, accepted).**
  R-C/Q8 resolves this as out of scope, matching `walk.ts:14-19`'s existing gap.
  Consequence, stated plainly: a gitignored local `notes.md` containing secrets
  can be attached and shipped to the LLM provider. The mitigations are
  `EXCLUDED_DIRS` and the attach-surface warning (UX-7/A04) — not prevention.
  If the user considers this unacceptable, honouring `.gitignore` (via the
  `ignore` dep or `git ls-files`) is a new work item, not a tweak.
- **R-5 — the polymorphic `surface_id` has no foreign key (R-D).** Deleting a
  skill or agent will orphan attachment rows unless WI6's explicit
  `deleteForSurface` cleanup lands. If R-D is rejected in favour of two tables,
  WI2/WI4/WI5 all change shape — decide before WI2.
- **R-6 — `client/messages/en/context.json` conflicts with SPEC-01 (R-A).** The
  plan resolves it in the Spec's favour and rewrites the namespace. This is the
  one place this plan deliberately overrides `client/INSIGHTS.md`'s
  "pre-authored copy is authoritative" rule; if that call is wrong, WI9's copy
  and D-3/D-4/D-5 need re-litigating first.
- **R-7 — stale INSIGHTS/doc text this plan cannot fix.**
  `client/src/lib/hooks/core.ts:122` claims the Project Context contract is
  "safe to call once API exposes it", and `hooks/repo-intel.ts:28` refers to a
  `ProjectContextView` that does not exist. Both are pre-feature scaffolding
  comments. `implementer` owns INSIGHTS updates at session end (this persona
  cannot write outside `docs/plans/`); note the correction there.
- **R-8 — WI13 mutates shared state: PR #3 is also the Blast Radius demo
  fixture.** `server/INSIGHTS.md` (2026-08-09 demo) records PR #3 as the live
  fixture for blast-radius verification, with a standing warning that a resync
  destroys it. A careless commit, force-push, or list Refresh during WI13
  therefore breaks an existing verification asset, not just this work item. Hence
  WI13's approval gate, the append-only commit (never force-push, never merge),
  and the explicit "do not click Refresh" step.
- **Not open, deliberately:** D-1…D-6 and R-C's answers to Q4/Q7/Q8/Q9/Q10 are
  decided. `implementer` must not silently re-decide them; a disagreement is
  flagged back, not resolved in code.

## Explicitly out of scope

Architecture review, security review, test authorship, and documentation updates
are owned by the downstream agents in the confirmed multi-agent chain — see
[agents/README.md](../../agents/README.md)#handoff-chain.
