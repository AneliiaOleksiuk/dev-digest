# Development Plan: SPEC-01 amendment — coverage, in-app authoring, clone integrity

Covers only the AC-29–AC-53 delta the SPEC-01 amendment added. The original
baseline (AC-1–AC-28: recursive discovery, the Project Context page's
list+preview, Skill/Agent Context tabs, attachment persistence, run-time
injection into `PromptParts.specs`, run-trace rendering) is **already
implemented and shipped** — see `server/src/modules/project-context/*`,
`client/src/app/repos/[repoId]/context/_components/ProjectContextView/*` and
the prior plan at [spec-01-project-context.md](spec-01-project-context.md).
None of it is re-planned here.

## Objective

Implement the AC-29–AC-53 delta the SPEC-01 amendment added on top of the
shipped Project Context feature: a client-side coverage indicator, in-app
document editing and creation writing into the repo clone behind a four-gate
guard chain, and a dirty-clone precondition on `GitClient.sync` so a resync
can no longer discard an uncommitted in-app edit.

## Scope

- Packages/modules touched: **server** (`src/modules/project-context/*`,
  `src/adapters/git/*`, `src/modules/repo-intel/service.ts`,
  `src/platform/errors.ts`, both vendored contract mirrors) and **client**
  (`src/app/repos/[repoId]/context/**`, `src/lib/hooks/context.ts`,
  `src/lib/types.ts`, `messages/en/context.json`). `reviewer-core/`, `e2e/`
  and `mcp/` are untouched.
- Execution mode: **multi-agent (full handoff chain)** — confirmed by the
  user: `implementer` → `test-writer` → `plan-verifier` → `doc-writer`, each
  a separate invocation, matching the prior Project Context plan.
- Explicitly out of scope: everything AC-1–AC-28 already ships
  (`server/src/modules/project-context/{routes,service,repository,
  repository.drizzle,discover,constants,helpers}.ts`,
  `client/src/app/repos/[repoId]/context/_components/ProjectContextView/*`,
  the run-executor wiring and trace rows from the prior plan); the Skill and
  Agent Context tabs
  (`client/src/app/skills/_components/SkillPreview/_components/ContextTab/*`,
  `client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/*`)
  stay attach-only read-preview per D-11; no delete/rename; no git operation
  on save (AC-38); no commit/discard action for a dirty clone; no DB schema
  change — editing and creation add no storage (AC-34, AC-42).

## Constraints

- **Onion architecture (server).** New write logic goes in
  `project-context/service.ts` plus a new pure guard module, never in
  `routes.ts` and never touching `db/client.ts`; `pnpm arch:check` must stay
  green.
- **Hand-mirrored vendor files are do-not-touch-by-tooling, not
  never-touch.** `server/src/vendor/shared/contracts/platform.ts` ↔
  `client/src/vendor/shared/contracts/platform.ts`, and the `GitClient.sync`
  docblock in both `*/src/vendor/shared/adapters.ts` copies, must be edited
  on one side and hand-copied to the other — no sync script (root
  `AGENTS.md` § Cross-cutting conventions; `server/AGENTS.md` § Do-not-touch).
- **Routes declare zod `params`/`body` schemas; no hand-rolled
  `Schema.parse(req.body)` in handlers** (`server/AGENTS.md` § Non-default
  conventions), and bodies are destructured to exactly
  `{ path, content, revision }` (NFR A08).
- **`bodyLimit` is hardcoded to 1 MB** (`server/AGENTS.md` § Gotchas) — a
  coarse bound only; AC-49's `MAX_DOC_FILE_BYTES` (256 KB,
  `project-context/constants.ts:19`) is the real cap and must be enforced in
  the service.
- **Client:** UI imports only from the `@devdigest/ui` barrel;
  `react-markdown` stays centralized in
  `src/vendor/ui/primitives/Markdown.tsx` (Edit mode is a plain `Textarea`,
  never a second renderer — NFR A05); all fetching goes through
  `src/lib/hooks/*` (`client/AGENTS.md`).
- **INSIGHTS entries that bind this work:**
  - `server/INSIGHTS.md` (2026-08-13, SPEC-01 entry, lines 584-626):
    *"grep every hand-typed object literal against an extended `z.infer`
    schema, not just the schema's own `.parse()` call sites, whenever a
    contract gains a new non-optional-with-default field"* — applies to
    every contract change in WI1.
  - `client/INSIGHTS.md` lines 556-567: `hooks/repo-intel.ts:28`'s comment
    about a `ProjectContextView` consuming `useResyncRepoIntel` is **stale —
    no such consumer exists**. WI10 creates the first one; the comment needs
    correcting (implementer owns INSIGHTS/comment updates).
  - `client/INSIGHTS.md`: run **bare `pnpm test`**, never `pnpm test run`
    (the extra arg silently narrows the suite and still exits green).
  - Root `INSIGHTS.md` § Tool & Library Notes: on
    `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`, call the binary directly
    (`./node_modules/.bin/vitest run`).
  - `server/INSIGHTS.md` (2026-08-09 demo note): **do not resync the PR #3
    fixture clone** — WI5 changes `sync()` behaviour, so any manual
    verification must use a throwaway fixture clone.

## Recommendations

- **Rec-1 — the AC-37 staleness token should be a content hash, not an
  mtime.** Return `revision` = sha256 hex of the file's bytes from the
  *existing* `GET /repos/:id/context/document` (`service.ts:115-127`) and
  require it back on save. mtime is the tempting cheap option and is wrong
  here: the dev environment is win32 (E-23's own premise), and a same-tick
  out-of-band write would pass an mtime check. Cost is one hash over a
  ≤256 KB file.
- **Rec-2 — add `ConflictError` (409) to `server/src/platform/errors.ts`.**
  `ValidationError` is 422 (`errors.ts:25-29`) and would make AC-37 (stale
  save, retriable by reloading) indistinguishable from AC-36/AC-43 (bad
  path, never retriable) at the UI. `app.ts:153` already maps any `AppError`
  to its own status, so this needs no error-handler change. Both remain
  "4xx" as the Spec requires.
- **Rec-3 — implement AC-44 as
  `writeFile(abs, content, { flag: 'wx' })`.** That is literally the
  "existence check atomic with the write" E-23 asks for, and on the
  case-insensitive win32 filesystem it correctly rejects `docs/a.md` when
  `docs/A.md` exists — which a `stat`-then-write would not.
- **Rec-4 — add `roots: string[]` to `ContextListing`.** UX-16's root picker
  needs the configured roots, and the client has no other way to learn them:
  inferring from `source_folder` values fails in exactly the case creation
  matters most — a repo with zero discovered documents (E-14). The server
  already holds `config.projectContextRoots` (`platform/config.ts:100`).
  This is a contract addition the Spec did not enumerate; reject it and WI9
  falls back to inferring roots and is broken on an empty repo.
- **Rec-5 — the Spec's "no contract widening" claim for AC-51 is true at the
  return-value level and insufficient at the user-visible level.**
  `resyncRepo`'s degraded `IndexResult` is swallowed by the RESYNC job
  handler (`repo-intel/service.ts:179-181`, whose own comment at 168-170
  says so), and `repo_index_state` has no `reason` column
  (`db/schema/repo-intel.ts:35-48`) — only `stats.reason` is projected out
  (`repo-intel/repository.ts:212-214`). WI5 therefore persists the dirty
  reason through the existing `touchIndexState(repoId, stats)`
  (`repository.ts:327-334`), which needs no migration. See R-4 for its one
  hole.
- **Rec-6 — one shared guard module used by both write paths, not a chain
  duplicated per route.** The Spec's own flowchart is a single ordered chain
  with a two-branch tail (create → exclusive write; edit → staleness check).
  Duplicating it is how one branch silently loses a gate.
- **Rec-7 — sequence server-before-client and land WI1 first**, the same
  reason the prior plan's R-E gave: both packages consume the same
  hand-mirrored contract file and nothing catches drift.

## Work items

### WI1 — Contracts + write-path constants (both vendor mirrors)

- **Files/modules:** `server/src/vendor/shared/contracts/platform.ts`
  (append after line 312), `client/src/vendor/shared/contracts/platform.ts`
  (hand-copy), `client/src/lib/types.ts` (re-export block, lines 30-36),
  `server/src/modules/project-context/constants.ts`.
- Adds: `ContextDocumentContent { path, content, revision }` (widens the
  inline preview response, Rec-1); `SaveContextDocumentBody
  { path, content, revision }`; `CreateContextDocumentBody
  { path, content }`; `ContextWriteResult { document: ContextDocument,
  revision }`; `roots: string[]` on `ContextListing` (Rec-4, `.default([])`
  so existing fixtures parse).
- Constants (values **approved by the user**, resolving the AC-47/D-12 half
  of Q7, anchored the same way `constants.ts:19,24` anchored
  `MAX_DOC_FILE_BYTES`/`MAX_DISCOVERED_DOCS` against
  `repo-intel/pipeline/walk.ts:1-70`):
  - `MAX_DOC_PATH_DEPTH = 8`
  - `MAX_DOC_PATH_LENGTH = 200` — safely under win32's 260-char `MAX_PATH`
    once a clone-dir prefix is added, the same win32 reasoning D-12 uses
  - `MAX_DIRTY_PATHS_SHOWN = 10` — AC-52's "bounded to a readable count"
- **ACs:** AC-37, AC-45, AC-47, AC-52 (shape only).
- **Applicable skills:** `zod`, `typescript-expert`.
- **Definition of done:** the two `platform.ts` copies are identical in the
  new block; every hand-typed `ContextListing`/preview-response literal in
  server and client tests compiles (per the `server/INSIGHTS.md` grep rule);
  `pnpm typecheck` clean in both packages; the three new constants carry
  docblocks naming the precedent they were anchored against, matching the
  file's existing style.

### WI2 — Write-path guard chain (pure module)

- **Files/modules:** new
  `server/src/modules/project-context/write-guards.ts`; imports
  `EXCLUDED_DIRS` from `server/src/modules/repo-intel/constants.ts:17-26`,
  `isInsideClone` from `server/src/modules/reviews/intent-inputs.ts:138`,
  and `DOC_EXT`/`MAX_DOC_FILE_BYTES`/`MAX_DOC_PATH_DEPTH`/
  `MAX_DOC_PATH_LENGTH` from `./constants.ts`.
- Exports, applied in the Spec flowchart's order:
  - `validateDocPathShape(path)` — rejects a non-`.md` extension, any `.` or
    `..` segment, any separator other than `/`, absolute / drive-letter
    (`C:/`) / UNC (`\\?\`) forms, any segment outside the ASCII
    `[A-Za-z0-9._-]` allowlist, and any path over `MAX_DOC_PATH_DEPTH` or
    `MAX_DOC_PATH_LENGTH`.
  - `resolveWritablePath(clonePath, roots, path)` — shape → first segment ∈
    configured roots → no segment in `EXCLUDED_DIRS` → `isInsideClone`,
    returning the absolute path or a typed rejection reason.
  - `assertContentWithinCap(content)` —
    `Buffer.byteLength(content, 'utf8') <= MAX_DOC_FILE_BYTES`.
- **ACs:** AC-35, AC-36, AC-43, AC-45, AC-46, AC-47, AC-49; closes E-22
  (`.git/hooks/*` is inside the clone but outside every configured root).
- **Applicable skills:** `typescript-expert`, `security`.
- **Definition of done:** no `node:fs` import in this file (pure, so every
  AC-47 clause is a distinct unit-testable rejection); each clause of
  AC-43/AC-45/AC-47 maps to its own rejection reason, not a shared boolean.

### WI3 — Service: save + create + `revision` on read

- **Files/modules:** `server/src/modules/project-context/service.ts`,
  `server/src/modules/project-context/helpers.ts`,
  `server/src/platform/errors.ts`.
- `helpers.ts`: `revisionOf(buf): string` (sha256 hex). `getDocumentContent`
  (`service.ts:115-127`) returns `revision` alongside `path`/`content`.
- `saveDocument(workspaceId, repoId, { path, content, revision })`: repo +
  `clonePath` check → WI2 guards → `stat` proves an **existing** file (else
  4xx — AC-36, and E-18's "edit a missing doc is rejected, recreate
  instead") → re-read and re-hash, mismatch → `ConflictError` (AC-37) →
  `writeFile` → return fresh metadata + new revision (AC-40). No git call on
  this path (AC-38). A failed write propagates as an error — never a partial
  success (AC-39, NFR A10).
- `createDocument(workspaceId, repoId, { path, content })`: WI2 guards →
  `mkdir(dirname, { recursive: true })` on the already-validated path
  (AC-46) → `writeFile(abs, content, { flag: 'wx' })`, `EEXIST` → 4xx
  (AC-44/E-23, Rec-3) → return metadata. No "manually added" record of any
  kind; the document enters the product on the next walk (AC-42).
- Logs record repo-relative path + byte count + outcome, never the submitted
  text (NFR A09).
- `errors.ts`: add `ConflictError` (`'conflict'`, 409) per Rec-2.
- **ACs:** AC-33 (server half — fresh read), AC-34, AC-36, AC-37, AC-38,
  AC-39, AC-40, AC-41, AC-42, AC-44, AC-46, AC-49.
- **Applicable skills:** `onion-architecture`, `typescript-expert`,
  `security`.
- **Definition of done:** no document text reaches any repository/DB call;
  `pnpm arch:check` green; both methods share WI2's chain rather than
  re-deriving it.

### WI4 — Routes for the two write paths

- **Files/modules:** `server/src/modules/project-context/routes.ts` (extend
  the module docblock at lines 10-22).
- `PUT /repos/:id/context/document` (save) and
  `POST /repos/:id/context/document` (create), each resolving
  `getContext(app.container, req)` **first** so a cross-workspace repo 404s
  before any filesystem touch (AC-48, matching lines 19-21,33), each with a
  zod `body` schema from WI1 and a destructured `{ path, content, revision }`
  (NFR A08).
- **ACs:** AC-45 (no multipart/binary — zod body only), AC-48.
- **Applicable skills:** `fastify-best-practices`, `zod`, `security`.
- **Definition of done:** no `Schema.parse(req.body)` in either handler; the
  docblock lists both new routes with their AC numbers, matching the file's
  existing style.

### WI5 — Dirty-clone precondition on `sync()` + distinct degraded reason

- **Files/modules:** `server/src/adapters/git/simple-git.ts:77-88`; new
  `server/src/adapters/git/errors.ts` (`DirtyCloneError` carrying
  `paths: string[]`); `server/src/adapters/mocks.ts:243-274`
  (`MockGitOptions` gains `dirtyPaths?: string[]`; `MockGitClient.sync`
  throws when set, so the refusal is testable without a real git fixture —
  the Spec requires this at "Clone integrity (server side)");
  `server/src/modules/repo-intel/service.ts:143-161`; the `GitClient.sync`
  docblock in **both** `server/src/vendor/shared/adapters.ts:205-215` and
  the client mirror.
- `sync()` runs `git status --porcelain --untracked-files=all` **before**
  `fetch`/`reset --hard` and throws `DirtyCloneError` when the output is
  non-empty (AC-50 — untracked included, because a created document is
  untracked). A clean clone gets byte-identical behaviour: same fetch, same
  reset, same returned head, no additional network call (AC-53).
- `resyncRepo` catches `DirtyCloneError` **before** its generic catch and
  returns the existing degraded envelope with
  `reason: 'dirty_clone:<up to MAX_DIRTY_PATHS_SHOWN paths>'` — never a
  `sync_failed:` string (AC-51). It then persists that reason through
  `tryGetIndexState` + `touchIndexState(repoId, { ...stats, reason })` so
  the job-swallowed result becomes observable at
  `GET /repos/:id/index-state` (Rec-5; no migration, `stats` is already
  jsonb).
- The vendored `adapters.ts` docblock change is comment-only and must be
  hand-mirrored to the client copy — the same sanctioned vendor exception
  `server/INSIGHTS.md` records for the `trace.ts` comment reconciliation.
- **ACs:** AC-50, AC-51, AC-53 (and it is AC-52's data source).
- **Applicable skills:** `typescript-expert`, `security`.
- **Definition of done:** the dirty check precedes the first network call;
  `reset --hard` is unreachable while the clone is dirty; `MockGitClient` can
  represent a dirty clone; both `adapters.ts` copies carry the identical
  precondition comment.

### WI6 — Client data layer + coverage helper

- **Files/modules:** `client/src/lib/hooks/context.ts` (add
  `useSaveContextDocument`, `useCreateContextDocument`; type
  `useContextDocument` with `revision`), `client/src/lib/types.ts`,
  `client/src/app/repos/[repoId]/context/_components/ProjectContextView/helpers.ts`.
- `computeCoverage(documents)` beside the existing `sumTokens` — excludes
  `missing: true` from **both** numerator and denominator (AC-29/E-24), and
  returns `null` when zero eligible documents remain so the caller renders
  nothing rather than `0`/`NaN` (AC-32). Mutations invalidate
  `["context-documents", repoId]` and `["context-document", repoId, path]`,
  matching the existing `onSuccess` pattern at `context.ts:65-69`.
- **ACs:** AC-29, AC-32 (computation), AC-40/AC-42 (invalidation).
- **Applicable skills:** `react-best-practices`, `next-best-practices`,
  `typescript-expert`.
- **Definition of done:** coverage is a pure function over the array the page
  already holds — no new endpoint, no new query (D-10); components still
  call no `fetch` directly.

### WI7 — Coverage indicator on the Project Context page

- **Files/modules:**
  `client/src/app/repos/[repoId]/context/_components/ProjectContextView/ProjectContextView.tsx`
  (header block, lines 50-57), `.../ProjectContextView/styles.ts`,
  `client/messages/en/context.json`.
- Computed over the **same `filtered` array** the AC-6/AC-7 summary already
  uses, so both follow one scope (AC-31, UX-17). Rendered with
  `CircularScore` from the `@devdigest/ui` barrel plus the self-describing
  label "N of M documents attached to at least one agent" (UX-12), never a
  bare number. A `null` coverage renders nothing (AC-32).
- **ACs:** AC-29, AC-31, AC-32. AC-30 is already satisfied server-side
  (`used_by_agents`, `service.ts:87`) and needs no client work.
- **Applicable skills:** `react-best-practices`, `react-project-structure`.
- **Definition of done:** no second filter path — one `filterDocuments`
  result feeds both the summary and the coverage indicator.

### WI8 — Preview/Edit toggle + Save

- **Files/modules:** new
  `client/src/app/repos/[repoId]/context/_components/ProjectContextView/_components/DocumentPanel/{DocumentPanel.tsx,index.ts,styles.ts}`;
  `ProjectContextView.tsx` preview pane (lines 111-130) delegates to it;
  `client/messages/en/context.json`.
- Entering Edit refetches the document so the editor is populated from a
  fresh read, never the cached body (AC-33 — the client half of the rule
  `service.ts:115-127` implements). Plain `Textarea` from the barrel (no
  second Markdown renderer — NFR A05); Preview re-enters the existing
  `Markdown` component. Adds the mode affordances UX-13 names and the design
  omits: a dirty-state indicator, an explicit Save, and a guard when
  switching document or leaving with unsaved text. One sentence at the Save
  affordance states that it writes the file and does not commit it (UX-14).
  A 409 renders as a distinct "changed on disk, reload" message, not the
  generic write-failure message (AC-37 vs AC-39).
- **ACs:** AC-33, AC-34 (client half), AC-37/AC-39 (surfacing), AC-40.
- **Applicable skills:** `react-best-practices`, `react-project-structure`,
  `security`.
- **Definition of done:** no `dangerouslySetInnerHTML`, no second
  `react-markdown` instance; the toggle lives only on this page, never on
  either Context tab (D-11).

### WI9 — New-document creation UI

- **Files/modules:** new
  `.../ProjectContextView/_components/NewDocumentDialog/{NewDocumentDialog.tsx,index.ts,styles.ts}`;
  `ProjectContextView.tsx` header action; `client/messages/en/context.json`.
- `Modal` + a root picker (`SelectInput`) over `ContextListing.roots`
  (Rec-4) + a relative-path `TextInput` + a `Textarea` for initial content,
  with `.md` appended by the UI so most AC-43/AC-47 rejections are
  unreachable (UX-16) — while the server still validates independently
  (D-12). The A04 outbound-data notice already at
  `ProjectContextView.tsx:136` must also be visible on this authoring
  surface. On success, invalidate the listing so the document appears via
  the ordinary walk (AC-42).
- **ACs:** AC-41, AC-42 (client half), AC-45 (client half), AC-47 (client
  half).
- **Applicable skills:** `react-best-practices`, `react-project-structure`.
- **Definition of done:** the dialog never sends an absolute path, a
  traversal segment, or a non-`.md` extension; the client's constraints are
  additive to, never a replacement for, WI2's server validation.

### WI10 — Blocked-resync refusal state

- **Files/modules:** new
  `.../ProjectContextView/_components/ResyncBlockedNotice/*` consuming
  `useRepoIntelStatus` (`client/src/lib/hooks/repo-intel.ts:31`, whose
  `RepoIntelState.reason` field at line 23 already exists);
  `ProjectContextView.tsx`; `client/messages/en/context.json`.
- Renders a `dirty_clone:` reason as an **instruction, not a failure**
  (UX-15): it names the affected paths (bounded, from the server's
  already-capped list) and says to commit or discard in the user's own git
  tooling, because this feature offers neither action (Non-goals). The path
  list is display text only — never input to another filesystem or shell
  operation (Untrusted-inputs table).
- **ACs:** AC-52.
- **Applicable skills:** `react-best-practices`, `react-project-structure`.
- **Definition of done:** the refusal is visually distinct from a
  network/fetch failure; this becomes the first real consumer of
  `useResyncRepoIntel`/`useRepoIntelStatus`, so the stale comment at
  `hooks/repo-intel.ts:28` is corrected in the same pass.

**Sequencing:** WI1 → WI2 → WI3 → WI4 → WI5 (server) → WI6 → WI7 / WI8 /
WI9 / WI10 (client), per Rec-7.

## Test plan

Commands exactly as each package's AGENTS.md states them:

- **server** (the test split is deliberately *not* in `package.json` and must
  be typed out):
  - `cd server && pnpm typecheck`
  - `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` (unit)
  - `cd server && pnpm exec vitest run .it.test` (integration — **needs
    Docker Postgres up**; check `docker ps` first, per root `INSIGHTS.md`)
  - `cd server && pnpm arch:check`
  - No `pnpm db:generate` / `pnpm db:migrate` this time — the delta adds no
    schema.
- **client** (`client/AGENTS.md`):
  - `cd client && pnpm typecheck`
  - `cd client && pnpm test` — **bare `pnpm test`**, never `pnpm test run`
    (`client/INSIGHTS.md`: the extra arg silently narrows the suite to files
    whose path contains "run" and still exits green)
- **reviewer-core** (`reviewer-core/AGENTS.md`; npm, not pnpm):
  - `cd reviewer-core && npm test` as a regression guard, plus
    `git diff --stat reviewer-core/` returning empty as the evidence that the
    "reviewer-core unchanged" constraint held.
- **Windows fallback** if any `pnpm <script>` aborts with
  `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`: call the binary directly —
  `./node_modules/.bin/vitest run` / `./node_modules/.bin/tsc --noEmit` under
  the Bash tool, `.\node_modules\.bin\vitest.cmd` under PowerShell (root
  `INSIGHTS.md` § Tool & Library Notes).

## Risks / Open questions

- **R-1 — RESOLVED.** Execution mode confirmed by the user: **multi-agent**
  (`implementer` → `test-writer` → `plan-verifier` → `doc-writer`). Tests,
  spec/architecture verification and docs belong to the downstream agents and
  are not folded into the work items.
- **R-2 — RESOLVED.** The AC-47/D-12 half of Q7 is decided by the user:
  `MAX_DOC_PATH_DEPTH = 8`, `MAX_DOC_PATH_LENGTH = 200`, baked into WI1's
  constants. `implementer` must not re-derive or "tune" these; a
  disagreement is flagged back. The rest of Q7 (total budget, walk bound,
  latency target) was already resolved by the prior plan's R-C and is
  untouched here.
- **R-3 — Q8 (gitignore) is sharpened by this amendment but does not block a
  work item.** A gitignored `.md` can now also be *edited*, and
  `git status --porcelain` omits ignored files, so such an edit neither
  blocks a resync (AC-50) nor is destroyed by one — E-19 records this as
  benign. The prior plan's R-4 accepted not honouring `.gitignore`; this plan
  carries that forward unchanged. If the user now wants writes restricted to
  non-ignored files, that is a new work item (an `ignore` dep or a
  `git ls-files` shell-out), not a tweak.
- **R-4 — the AC-51 → AC-52 wiring has one hole even after Rec-5.**
  `touchIndexState` (`repo-intel/repository.ts:327-334`) updates an existing
  row and no-ops when a repo has never been indexed, so a dirty clone on a
  never-indexed repo shows the generic `no_data` state instead of the dirty
  reason. Accepted (a never-indexed repo has nothing to resync anyway) —
  recorded so `plan-verifier` reads it as a known limitation, not a missed
  AC. If it is judged unacceptable, WI5 upserts a synthetic row instead.
- **R-5 — AC-52 needs a surface that does not exist yet.**
  `useResyncRepoIntel` has no caller anywhere in `client/src` (confirmed by
  grep and by `client/INSIGHTS.md:556-567`). This plan puts the refusal on
  the Project Context page per D-11/UX-15 — the page whose edits cause the
  dirtiness. If the intended home is the repo header or the Conventions page
  instead, say so before WI10 starts.
- **R-6 — a failed exclusive create can leave empty directories behind.**
  AC-46 creates the nested path before the `wx` write; if the write then
  fails, the directories remain. Accepted and named rather than fixed with a
  rollback that would introduce its own delete path (Non-goals: no in-app
  delete).
- **R-7 — AC-38 and AC-53 need a real git fixture clone**, not the mock:
  AC-38 asserts `git status --porcelain` shows the file modified and `HEAD`
  unchanged after a save, and AC-53 asserts pre-amendment behaviour on a
  clean clone. `MockGitClient`'s new `dirtyPaths` covers AC-51's
  service-level branch only.
- **R-8 — stale comment this plan cannot fix directly.**
  `client/src/lib/hooks/repo-intel.ts:28` refers to a `ProjectContextView`
  consumer that does not exist; WI10 makes it exist, so the comment must be
  corrected rather than left doubly stale. `implementer` owns INSIGHTS and
  comment updates at session end.
- **Not open, deliberately:** D-7 through D-12 are decided, as are the prior
  plan's R-C answers to Q4/Q8/Q10. `implementer` must not silently
  re-decide them; a disagreement is flagged back, not resolved in code.

## Explicitly out of scope

- Architecture review, security review, test authorship, and documentation
  updates are owned by the downstream agents in the confirmed multi-agent
  chain — see [agents/README.md](../../agents/README.md)#handoff-chain.
- Re-planning any of AC-1–AC-28, which already ship per
  [docs/plans/spec-01-project-context.md](spec-01-project-context.md).
