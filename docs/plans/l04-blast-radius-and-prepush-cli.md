# Development Plan: L04 — Blast Radius (server + client + MCP) & pre-push review CLI

> **Decisions applied 2026-08-08** (user, via coordinator): Open Questions 1, 2,
> 4 and 6 are **resolved** below — see the Risks section for each. The two most
> load-bearing: (a) the 5 existing MCP tools' design is **not touched**; the CLI
> is a separate additive entry point that may import `reviewer-core` in-process.
> (b) **No new graph-traversal code** — the existing endpoint detection is
> reused as-is.

### Objective

Two related L04 deliverables:

1. **Blast Radius** — answer "what else could this diff touch?" for a PR:
   which symbols are declared in the changed files, who calls them, and which
   HTTP endpoints might be affected. Surfaced as `GET /pulls/:id/blast`, a
   fourth **Blast** tab on the PR page, and a real `get_blast_radius` MCP tool
   (replacing today's stub). The nodes and edges always come from the existing
   `repo-intel` index — **never** from a model.
2. **`devdigest review --mode working`** — a pre-push CLI in the `mcp/`
   package that runs the *same* reviewer (`reviewer-core`'s
   `reviewPullRequest`) against the local working tree, prints findings to the
   terminal, and exits with a deterministic code — with no API server and no
   database required.

### Scope

- **Packages/modules touched**
  - `server/` — new `src/modules/blast/`; a **required** caller-cap bug fix in
    `src/modules/repo-intel/service.ts`; one new contract in the vendored
    `@devdigest/shared` (mirrored to `client/`). **No new `repo-intel` facade
    methods** — see WI4.
  - `client/` — new `_components/BlastTab/`, new `lib/hooks/blast.ts`, a 4th
    tab in `PrDetailHeader`/`page.tsx`, `BlastRadiusCard` upgraded from its
    always-unavailable placeholder.
  - `mcp/` — `get_blast_radius` implemented for real (still a pure HTTP façade);
    **new, separate** CLI entry point (`src/cli.ts` + `src/cli/*`);
    `tsconfig.json` gains a `@devdigest/reviewer-core` alias used **only** by
    the CLI; `.github/workflows/mcp.yml` gains a reviewer-core install step.
  - `reviewer-core/` — receives `parseUnifiedDiff` (see WI11 / Open Q7).
  - Docs: `mcp/README.md`, `mcp/AGENTS.md`, `server/src/modules/repo-intel/README.md`,
    `server/README.md`, root `AGENTS.md`, `TESTING.md`.
- **Explicitly out of scope**
  - Re-indexing / changing the `repo-intel` **pipeline**
    (`pipeline/*`, `walk.ts`, `rank.ts`, `repo-map.ts`) or its schema. Blast is
    a *read* over the already-built index (`server/src/modules/repo-intel/README.md`).
  - **Any new graph-traversal code.** A reverse import-graph BFS was considered
    and **rejected** (user decision, 2026-08-08): the existing endpoint
    detection inside `getBlastRadius` is reused as-is, and its depth limit is
    documented rather than extended. See WI4.
  - **Any change to the 5 existing MCP tools' design.** `mcp/AGENTS.md`'s
    "HTTP-only, never in-process" rule, their no-secrets/no-LLM posture, and
    their code path stay exactly as they are. WI7 stays a pure HTTP façade.
  - Any new migration or table. `symbols`, `references`, `file_edges`,
    `file_rank`, `file_facts`, `pr_files` all already exist and already carry
    everything this feature needs.
  - `e2e/` — no browser flow added for the Blast tab in this pass.
  - `--mode staged` / `--mode branch` implementations (architecture must
    *allow* them; WI12 registers them as explicit "not implemented" modes).
  - Publishing `@devdigest/mcp` to a registry.

### Constraints

**From root `AGENTS.md`**
- **Not a monorepo.** Cross-package sharing is via **tsconfig path aliases**,
  never workspace/npm deps. The CLI's use of `reviewer-core` must follow the
  same alias mechanism `server/tsconfig.json` already uses
  (`"@devdigest/reviewer-core": ["../reviewer-core/src/index.ts"]`).
- **`@devdigest/shared` is hand-copied** into `server/src/vendor/shared` and
  `client/src/vendor/shared`; no sync script. WI3 edits one and hand-mirrors
  the other — that is the sanctioned route around the `*/src/vendor/**`
  do-not-touch entry, which means "no tooling generates this", not "never
  change it". Do **not** create a third vendor copy in `mcp/`.
- **Secrets never live in git or the DB** — `~/.devdigest/secrets.json`
  (mode 0600, `process.env` fallback). Confirmed:
  `server/src/platform/config.ts` sets
  `secretsPath: join(homedir(), '.devdigest', 'secrets.json')`. The **CLI**
  reads that file directly (WI12); the 5 MCP tools still read nothing. Nothing
  may print or log a key.
- **Migrations are never applied on boot** — irrelevant here (no migration).
- **Do-not-touch:** `*/src/vendor/**` (hand-mirror, see above),
  `*/src/db/migrations/**` (regenerate via `pnpm db:generate`; this plan needs
  neither).

**From `server/AGENTS.md` + verified in code**
- Routes declare zod `params`/`body` schemas; invalid input 422s **before** the
  handler. Use `IdParams` from `modules/_shared/schemas.ts` — do not hand-roll
  `Schema.parse(req.body)`.
- Services depend on adapter/repository **interfaces**; tests swap
  `ContainerOverrides`. `ContainerOverrides.repoIntel` already exists, so the
  blast service is unit-testable with a fake facade and no DB.
- `reapStaleRuns()` assumes a **single** API process. This is the reason the 5
  MCP tools are HTTP-only — and the reason WI10's CLI exception must be written
  down explicitly rather than silently assumed.

**From `mcp/AGENTS.md`**
- **HTTP-only, never in-process** — the MCP **tools** never import `server/src`
  at runtime; only `import type … from '@devdigest/shared'`. WI7 obeys this
  unchanged. WI10 adds a documented, deliberate **exception for the CLI only**;
  see Risks item 6.
- **stdout is the protocol channel** — nothing may `console.log` in the stdio
  server path. The CLI is a *different* entrypoint and legitimately writes to
  stdout; WI15 must record that scoping so a future reader doesn't "fix" the
  CLI's output into stderr.
- `registerTool`'s `inputSchema`/`outputSchema` take a raw zod **shape**, not a
  `z.object(...)`; `schemas.ts` exports both per DTO.
- `CallToolResult.structuredContent` **must be a JSON object, not a bare
  array** (`mcp/INSIGHTS.md`). WI7's output is already object-shaped — keep it
  that way.
- Every `@devdigest/shared` import in `mcp/` is `import type`; the three enums
  it needs are redeclared locally in `schemas.ts`.

**From `reviewer-core/AGENTS.md`**
- The package is **pure**: no DB, GitHub, or filesystem access; the only side
  effect is an injected `LLMProvider`. That purity is exactly why the CLI may
  import it (WI10).
- Changing its public API means updating **both** `src/index.ts`'s exports and
  every import site in `server/`. Relevant to WI11.
- It is the only **npm** package besides `e2e/` and `mcp/` — don't "fix" the
  lockfile split.

**From `client/AGENTS.md`**
- All data fetching goes through `src/lib/hooks/*` — never ad hoc `fetch` in a
  component.
- Feature logic lives in colocated `_components/<Name>/` folders next to the
  page, each with its own `*.test.tsx`; pages stay thin.
- Import UI **only** from the `@devdigest/ui` barrel.
- `src/vendor/ui/**` and `src/vendor/shared/**` are do-not-touch (the
  `vendor/shared` mirror edit in WI3 is the documented exception; `vendor/ui`
  is genuinely untouched here — no new nav entry is needed, Blast is a tab on
  an existing route).

**Relevant `INSIGHTS.md` entries (cited)**
- `client/INSIGHTS.md` → Codebase Patterns, *"A route's
  `client/messages/en/<feature>.json` can already encode the intended UX before
  any component exists"*: **`client/messages/en/blast.json` already exists and
  is pre-authored** (`stat.symbols|callers|endpoints|crons`, `view.tree|graph`,
  `callerCount`, `noDownstream`, `graph.empty|ariaLabel`). Treat it as
  authoritative course scaffolding, not filler — it is more specific than the
  task brief (see WI5 and Open Q4).
- `client/INSIGHTS.md` → What Doesn't Work, *"`pnpm test run` is not 'run the
  tests'"*: run bare `pnpm test`.
- `client/INSIGHTS.md` → Codebase Patterns: `BlastRadiusCard` is a **top-level**
  `_components/BlastRadiusCard/` on purpose (Overview-tab-level panel, like
  `IntentCard`), whereas single-consumer children nest under their parent's own
  `_components/`. `BlastTab` follows `DiffTab`/`FindingsTab` — top-level.
- `server/INSIGHTS.md` → Recurring Errors & Fixes: the seeded
  `acme/payments-api` has `clone_path: null`; **it cannot be the smoke target
  for blast** (no clone ⇒ no index ⇒ permanently degraded). Also: 6 Windows-only
  flakes in `test/indexer-pipeline.test.ts`.
- `server/INSIGHTS.md` → Codebase Patterns: `repoIntel` returns **repo-root
  relative** paths as tracked in git — join them onto `clonePath` directly.
- `server/INSIGHTS.md` → Codebase Patterns: the vendored `trace.ts` copies have
  pre-existing comment drift — do **not** widen or "fix" it while mirroring
  `review-api.ts` in WI3.
- `root INSIGHTS.md` → Tool notes: `pnpm <script>` can abort with
  `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` in this shell (call
  `./node_modules/.bin/<bin>` directly); Docker Desktop is not auto-started.
- `mcp/INSIGHTS.md` → What Works, third bullet, is **wrong as written** — see
  Risks item 9. It claims a *value* import from `@devdigest/shared` would crash
  at spawn with `ERR_MODULE_NOT_FOUND`; verified this session that it does not.

**Corrections to the task brief (verified this session)**
- ✅ `RepoIntelService.getBlastRadius` exists and returns `BlastResult`; the
  declaring file is excluded (`if (r.fromPath === sym.file) continue`).
- ❌ **The 20-caller cap is worse than suspected.** In `tryPersistentBlast`
  the merged array is sorted globally (`callers.sort((a,b) => b.rank - a.rank)`)
  and then `callers.slice(0, MAX_CALLERS_PER_SYMBOL)` — a **global** cap of 20
  across the whole result. And the ripgrep fallback inside `getBlastRadius`
  applies **no cap and no sort at all** (every caller row is emitted with
  `rank: 0`). Neither path satisfies "20 callers per symbol, sorted by file
  rank". `constants.ts`'s own comment already states the intended semantics
  ("Caller fan-out cap **per changed symbol** (ORDER BY rank DESC LIMIT N)"),
  so WI1 is a bug fix, not a behaviour change.
- ✅ No `GET /pulls/:id/blast` route exists; no `server/src/modules/blast/`
  folder exists.
- ✅ No reverse import-graph traversal exists — **and none is being added**
  (user decision; see WI4). For the record: `getCriticalPaths` is **forward**
  (importer → imported) and is a *greedy single-chain walk* (takes the one
  highest-ranked target per hop), not a BFS — it was never reusable for this
  anyway.
- ✅ Endpoint detection today is symbol-reference-scoped: the persistent path
  reads `file_facts` **only for caller files**; the ripgrep path re-parses
  caller files with `extractEndpoints`. Neither walks the import graph. WI4
  documents the resulting depth limit instead of closing it.
- ✅ `BlastRadiusCard` always renders the unavailable state; PR page has 3 tabs
  driven by `?tab=`.
- ➕ **New:** `client/messages/en/blast.json` already exists (brief didn't
  mention it) and specifies more UI than the brief did.
- ➕ **New:** a `BlastRadius` Zod contract already exists in the vendored
  `contracts/brief.ts` (`changed_symbols` / `downstream[]` / `summary`) — the
  response contract should extend it, not invent a parallel shape. The
  established place for API-facing response shapes is
  `contracts/review-api.ts` (precedent: `SmartDiffResponse = SmartDiff`).
- ✅ `mcp/src/tools/get-blast-radius.ts` is a registered stub; `mcp/AGENTS.md`
  documents HTTP-only; `docs/plans/mcp-server.md` WI3/5/7 sets the schema /
  error / annotation conventions.
- ✅ `mcp/package.json` has **no** `bin` entry and no CLI script — WI13 is
  genuinely new.
- ✅ `mcp/tsconfig.json` has **no** `@devdigest/reviewer-core` alias — WI10 adds
  it.
- ➕ **New:** the `AgentManifest` contract (`contracts/eval-ci.ts`) already
  describes a file-based agent config (`.devdigest/agents/<slug>.yaml`), but
  **nothing in this repo reads or writes it** — the `CiService.agentYaml` its
  docblock names does not exist. Relevant to WI12.

### Work items

---

#### Part 1 — Blast Radius

**WI1. [REQUIRED BUG FIX] Cap + rank-sort callers per changed symbol, in
`repo-intel`.**
- Decision (user, 2026-08-08): fix this **in the `repo-intel` facade**, not by
  post-processing in the new blast module — the facade's global slice already
  discards rows a downstream consumer could never recover.
- Files/modules:
  - `server/src/modules/repo-intel/service.ts` — `tryPersistentBlast` (the
    `callers.sort(...)` + `callers.slice(0, MAX_CALLERS_PER_SYMBOL)` pair) and
    the ripgrep path in `getBlastRadius` (the `callerRows` loop, which caps
    nothing and sorts nothing).
  - `server/src/modules/repo-intel/constants.ts` — comment only, if the
    semantics need restating.
  - `server/test/repo-intel-facade-degraded.test.ts` — the existing
    "never throws / degraded-but-valid shape" coverage must stay green.
  - `server/test/repo-intel-blast-cap.test.ts` (new, or an added `describe` in
    the file above) — the per-symbol capping test required by the DoD.
- Implementation: group `callers` by `viaSymbol`; within each group sort by
  `rank` **desc** with a deterministic tiebreak (`file` asc, then `line` asc —
  needed because the ripgrep path has `rank: 0` for every row); take the first
  `MAX_CALLERS_PER_SYMBOL` of each group; concatenate groups in changed-symbol
  order. Apply the identical helper on **both** paths so they can't drift.
- Applicable skills: `typescript-expert`. (`onion-architecture` does **not**
  apply — it is scoped to *new* folders under `server/src/modules/`, per its own
  description and `server/.dependency-cruiser.cjs`.)
- Definition of done: a **test** feeds one changed symbol with >20 callers and a
  second changed symbol with a handful, and asserts (a) exactly
  `MAX_CALLERS_PER_SYMBOL` rows survive for the first `viaSymbol`, (b) **all**
  of the second symbol's callers survive (i.e. the first symbol's fan-out no
  longer starves it), (c) each group is ordered by `rank` desc, and (d) the
  same assertions hold on the ripgrep/degraded path with a stable ordering.
  Existing repo-intel tests unchanged and passing.

**WI2. New `server/src/modules/blast/` module + `GET /pulls/:id/blast`.**
- Files/modules (folder shape copied from `server/src/modules/smart-diff/`, the
  closest and most recent precedent):
  - `server/src/modules/blast/routes.ts` — `app.get('/pulls/:id/blast', { schema: { params: IdParams } }, …)`,
    `getContext(container, req)` for `workspaceId`, delegates to the service.
  - `server/src/modules/blast/service.ts` — orchestration only.
  - `server/src/modules/blast/repository.ts` — port interface + plain types (no
    Drizzle import), mirroring `smart-diff/repository.ts`:
    `getPull(workspaceId, prId): Promise<{ id, repoId } | undefined>` and
    `getPrFiles(prId): Promise<string[]>`.
  - `server/src/modules/blast/repository.drizzle.ts` — Drizzle adapter over
    `t.pullRequests` / `t.prFiles`.
  - `server/src/modules/blast/constants.ts` — display caps (max changed symbols
    rendered, max endpoints listed).
  - `server/src/modules/index.ts` — one import + one registry entry.
  - `server/src/platform/container.ts` — a lazy `get blastRepo()` getter,
    mirroring `get smartDiffRepo()`.
- Behaviour:
  1. `getPull` → 404 via `NotFoundError` ("Pull request not found") when the
     PR is missing or belongs to another workspace — same as
     `SmartDiffService.getSmartDiff`.
  2. `getPrFiles` → changed paths. **`pr_files` is only populated once
     `GET /pulls/:id` has run** (documented in `smart-diff/service.ts`). An
     empty list must return `status: 'degraded'` with a reason naming the fix,
     **never** a 200 with empty arrays presented as "no impact".
  3. `container.repoIntel.getBlastRadius(repoId, paths)` and
     `container.repoIntel.getIndexState(repoId)` in parallel. These are the
     **only** two facade calls — no new facade methods (WI4).
  4. Map `BlastResult` → the `BlastRadiusResponse` contract (WI3): group
     `callers` by `viaSymbol` into `downstream[]`, attach
     `endpoints_affected` / `crons_affected` per symbol from
     `BlastResult.factsByFile` keyed by that symbol's caller files (falling
     back to the flat `impactedEndpoints` union when `factsByFile` is absent,
     i.e. on the degraded path). **Note:** `factsByFile` is the *only* source of
     crons, and it exists only on the persistent path — on the degraded/ripgrep
     path `crons_affected` is legitimately always empty (`extractEndpoints` is
     called, `extractCrons` is not). The UI must not read an empty crons list as
     "no scheduled jobs affected" when `status !== 'full'`.
  5. `status`: `'full' | 'partial' | 'degraded'`, derived from
     `IndexState.status` **and** `BlastResult.degraded` —
     degraded when `blast.degraded === true` or the index status is
     `degraded`/`failed`; `partial` when the index status is `partial`;
     otherwise `full`. `reason` is a human sentence, never a bare enum
     (e.g. "This repo's index is partial (1,842 of 2,610 files) — some callers
     may be missing. Re-run the index from the repo page.").
  6. `summary`: a **deterministic, server-composed** sentence (counts of
     symbols / callers / files / endpoints) that also states the depth limit
     WI4 documents. No LLM on this path.
- Applicable skills: `onion-architecture` (this is exactly its trigger: a new
  folder under `server/src/modules/`), `fastify-best-practices`,
  `drizzle-orm-patterns` (the `repository.drizzle.ts` reads),
  `zod`, `typescript-expert`.
- Definition of done: `cd server && pnpm arch:check` passes (routes → service →
  port ← adapter, no `db/client.ts` import from `service.ts`); an unknown or
  foreign-workspace `:id` returns 404; a malformed `:id` returns 422 from the
  schema, not the handler; the handler's return value parses against
  `BlastRadiusResponse`.

**WI3. `BlastRadiusResponse` contract, in both vendored copies.**
- Files/modules:
  - `server/src/vendor/shared/contracts/review-api.ts` — add
    `BlastRadiusResponse = BlastRadius.extend({ status: z.enum(['full','partial','degraded']), reason: z.string().nullable() })`
    next to the existing `SmartDiffResponse = SmartDiff` (same file, same
    pattern, same section).
  - `client/src/vendor/shared/contracts/review-api.ts` — **hand-mirror,
    byte-identical**.
- Reuses `BlastRadius` / `DownstreamImpact` / `BlastCaller` / `ChangedSymbol`
  from `contracts/brief.ts` unchanged — do **not** add `rank` to `BlastCaller`
  (it is shared with the unbuilt `PrBrief`); ordering is carried by array
  order, already rank-sorted server-side by WI1.
- Do **not** touch the vendored `trace.ts` comment drift while in this
  directory (`server/INSIGHTS.md`).
- Applicable skills: `zod`, `typescript-expert`.
- Definition of done: both copies diff-clean against each other for this file;
  `cd server && pnpm typecheck` and `cd client && pnpm typecheck` both resolve
  the new export.

**WI4. Verify and document the endpoint-detection depth — build no new
traversal.**
- Decision (user, 2026-08-08): **reuse the existing mechanism.** Do not build a
  reverse import-graph BFS, and do not add facade methods for one. This work
  item is verification + honest wording, not new traversal code.
- What the existing mechanism actually does (read this session, both paths):
  - **Persistent path** (`tryPersistentBlast`):
    `RepoIntelRepository.getResolvedCallers(repoId, changedFiles, names)`
    selects `references` rows whose `decl_file` is a changed file and whose
    `to_symbol` is a changed symbol — i.e. **direct** callers only. Then
    `getFileFacts(repoId, callerFiles)` returns the endpoints/crons the indexer
    precomputed **for those same caller files**.
  - **Ripgrep fallback** (`getBlastRadius`): `codeIndex.references(ref, name)`
    → caller files → `extractEndpoints(<caller file contents>)`, computed live.
  - Chain in both cases: *changed file (declares symbol) → file that directly
    calls it → endpoints declared in that same calling file.* It never examines
    callers-of-callers or importers-of-importers.
- **How this maps onto "capped at 2 levels":** under the reading "levels = files
  in the chain", it satisfies the requirement and **cannot structurally exceed
  it** (there is no recursion to cap). Under the reading "levels = hops from the
  changed file", it reaches **one** hop, and a two-hop reach (an endpoint in a
  file that calls a file that calls the changed code) is a **known gap**. State
  this plainly; do not invent traversal to force a literal match.
- Deliverables:
  - The wording in WI2's `summary` (and the Blast tab's header copy in WI5)
    says endpoints are those declared in files that **directly** call a changed
    symbol — so the map is never over-claimed.
  - One short paragraph in `server/src/modules/repo-intel/README.md` recording
    the depth limit and that closing it was deliberately deferred.
- Applicable skills: none (verification + prose).
- Definition of done: no new method on the `RepoIntel` interface
  (`server/src/modules/repo-intel/types.ts` unchanged apart from comments); no
  new use of `RepoIntelRepository.getEdges`; the depth limit is stated in both
  the API `summary` and the repo-intel README.

**WI5. Client — the Blast tab.**
- Files/modules:
  - `client/src/lib/hooks/blast.ts` — `useBlastRadius(prId)`, a verbatim
    structural copy of `lib/hooks/smart-diff.ts`
    (`useQuery`, `queryKey: ["blast", prId]`, `api.get<BlastRadiusResponse>(...)`,
    `enabled: !!prId`). No `fetch` in components.
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastTab/` —
    `BlastTab.tsx`, `styles.ts`, `index.ts` (+ `helpers.ts` if the grouping
    logic needs a home). Top-level under the route's `_components/`, matching
    `DiffTab`/`FindingsTab`/`BlastRadiusCard`.
  - `client/src/app/repos/[repoId]/pulls/[number]/page.tsx` — a
    `{tab === "blast" && <BlastTab … />}` branch alongside the existing three.
  - `.../_components/PrDetailHeader/PrDetailHeader.tsx` — a 4th `tabs` entry
    `{ key: "blast", label: "Blast", icon: "GitBranch" }` (`GitBranch` matches
    `BlastRadiusCard`'s existing icon choice, per `client/INSIGHTS.md`
    2026-08-07).
  - `.../_components/BlastRadiusCard/BlastRadiusCard.tsx` — replace the
    always-unavailable state with a compact summary (the four stat counts + a
    "View blast radius" affordance switching to `?tab=blast`), keeping the
    honest unavailable state when `status === 'degraded'`. Its header comment
    ("No `GET /blast-radius` endpoint exists yet … ALWAYS renders the honest
    unavailable empty state") must be rewritten, not left lying.
- **i18n:** use the pre-authored `client/messages/en/blast.json` via
  `useTranslations("blast")` — it already defines the four stat labels
  (`symbols`/`callers`/`endpoints`/**`crons`**), `callerCount`,
  `noDownstream`, and a `view.tree` / `view.graph` toggle. Author only the keys
  genuinely missing (degraded/partial banner copy, the "direct callers only"
  depth note from WI4; the tab label stays hardcoded English, consistent with
  the existing three).
- Rendering: changed symbols → their callers → the endpoints/crons they reach;
  `status !== 'full'` renders an explicit banner with `reason` above the data —
  **never** an empty list that reads as "no impact". Per WI2 step 4, when
  `status !== 'full'` the crons stat must be rendered as unknown/unavailable,
  not as a confident `0`.
- Applicable skills: `react-project-structure` (placement of the new component
  folder + hook), `react-best-practices`, `next-best-practices`,
  `typescript-expert`.
- Definition of done: `?tab=blast` renders the tab and survives a reload;
  `cd client && pnpm typecheck` clean; `src/test/smoke.test.tsx` (the
  `/showcase` mount) still passes.

**WI6. Clickable `file:line` in the Blast tab.**
- Files/modules: `BlastTab.tsx` (+ its styles), reusing
  `client/src/lib/github-urls.ts`'s `githubBlobUrl(repoFullName, sha, file, startLine, endLine)`
  and `@devdigest/ui`'s `MonoLink` — the exact prior art in
  `_components/FindingCard/FindingCard.tsx`
  (`<MonoLink href={fileHref}>{file}:{lineLabel(finding)}</MonoLink>`).
  `repoFullName` and `headSha` are already computed in `page.tsx` and just need
  threading into `BlastTab`.
- **Important difference from findings:** blast callers live in files that are
  *not* in the diff, so they must **not** be linked into the diff viewer or
  through `focusFindings` — the correct target is the GitHub blob at the PR's
  head SHA, which resolves for untouched files too.
- `repoFullName === null` → `MonoLink` renders unlinked text (already its
  behaviour when `href` is undefined); no broken link.
- Applicable skills: `react-best-practices`, `typescript-expert`.
- Definition of done: a manual click on one caller link opens the right file at
  the right line on github.com (task requirement #8 — confirm, don't assume);
  a repo with no `full_name` renders plain text without errors.

**WI7. MCP `get_blast_radius` — replace the stub with a real HTTP-backed tool.**
- **This tool stays a pure HTTP façade.** The 5 MCP tools' design is explicitly
  out of scope for change (user decision) — no `reviewer-core` import, no
  `server/src` import, no secrets, no LLM call in this code path. The CLI's
  in-process exception (WI10) does **not** extend here.
- Files/modules:
  - `mcp/src/schemas.ts` — add `GetBlastRadiusOutputShape` + schema next to the
    existing (already-declared) `GetBlastRadiusInputShape`, following the
    established `*Shape` + `z.object(*Shape)` pair convention.
  - `mcp/src/project.ts` — pure mapping from `BlastRadiusResponse` (type-only
    import) to the compact DTO.
  - `mcp/src/tools/get-blast-radius.ts` — resolve `repo` → `pr` via
    `resolve.ts`, `api.get(`/pulls/${pull.id}/blast`)`, `buildResult(...)`;
    failures through `apiFailureToolError` / `toolError` (no `throw`).
    Annotations become `readOnlyHint: true, openWorldHint: false` and the
    title/description drop "not implemented yet".
  - `mcp/test/get-blast-radius.test.ts` — rewrite: happy path, degraded-status
    path, unknown repo/pr path.
  - `mcp/README.md`, `mcp/AGENTS.md` — the tool is no longer a stub.
- Constraints to honour: `structuredContent` must be an **object** (it already
  is); token frugality — cap symbols and callers and emit `omitted_*` counters
  when capped, mirroring `MAX_FINDINGS`'s treatment in `schemas.ts`.
- Applicable skills: `zod`, `typescript-expert`.
- Definition of done: `list_tools` still returns 5 tools, `get_blast_radius`'s
  description no longer says "not implemented"; the handler's payload
  `.parse()`s against its output schema; no `throw` in
  `mcp/src/tools/get-blast-radius.ts`; `grep -r "reviewer-core\|server/src" mcp/src/tools`
  returns nothing.

**WI8 (optional / stretch). One-paragraph LLM explanation of the map.**
- Only if Open Q5 is answered "build it now". Shape: a **separate**
  `POST /pulls/:id/blast/explain` that overwrites only `summary`; the
  `changed_symbols` / `downstream` arrays are passed to the model as context
  and are **never** re-read from its output. Model resolution goes through
  `resolveFeatureModel(..., '<featureId>')`
  (`server/src/modules/settings/feature-models.ts`) — the pattern the
  Conventions Extractor already established — so the feature is reroutable
  without a code change when a provider key is exhausted
  (`server/INSIGHTS.md`).
- Applicable skills: `fastify-best-practices`, `zod`, `security` (untrusted
  model output must not reach the nodes/edges), `typescript-expert`.
- Definition of done: with the LLM stubbed/unavailable, `GET /pulls/:id/blast`
  is byte-identical to its pre-WI8 output.

---

#### Part 2 — pre-push CLI

**WI10. Wire the CLI's execution model: in-process `reviewer-core`, no server,
no DB — scoped to the CLI only.**
- **Decision (user, 2026-08-08): approved, with the MCP concept unchanged.**
  Write this scoping down explicitly so no future reader misreads it:
  - The **5 MCP tools** (`list_agents`, `run_agent_on_pr`, `get_findings`,
    `get_conventions`, `get_blast_radius`) keep their documented design
    verbatim: HTTP-only façade over the running API, no secrets, no LLM calls,
    no `server/src` import. This work does not touch that code path.
  - The **pre-push CLI is a separate, additive entry point** in the same npm
    package — its own `src/cli.ts` + `src/cli/` module, its own invocation
    (WI13). It is **not** an MCP tool and is **not** reachable over the MCP
    stdio protocol.
  - For that CLI module only, importing `@devdigest/reviewer-core` in-process
    is approved. `mcp/AGENTS.md`'s "never in-process" rationale
    (`reapStaleRuns()`'s single-API-process assumption, the in-memory `runBus`)
    is about not fighting the **server process** — irrelevant to a one-shot CLI
    that never imports `server/src` and never runs alongside itself.
- Files/modules: `mcp/tsconfig.json` (add
  `"@devdigest/reviewer-core": ["../reviewer-core/src/index.ts"]` and
  `"@devdigest/reviewer-core/*": ["../reviewer-core/src/*"]`, matching
  `server/tsconfig.json`), `mcp/AGENTS.md` (WI15 writes the exception sentence).
- **Verified this session, not assumed:**
  - `tsx` *does* resolve `mcp/tsconfig.json`'s `paths` at runtime — a probe
    file in `mcp/src/` doing a **value** import
    (`import { Review } from '@devdigest/shared'`) ran cleanly under
    `./node_modules/.bin/tsx`. (This contradicts `mcp/INSIGHTS.md`; see Risks
    item 9.)
  - Importing `reviewer-core`'s source from `mcp/` works at runtime — a probe
    importing `reviewPullRequest` / `OpenRouterProvider` / `countBlockers`
    resolved fine; `openai` and `zod` resolve out of `reviewer-core/node_modules`
    by normal Node lookup, the same mechanism `server/AGENTS.md` already
    documents ("If `reviewer-core/node_modules` is missing, the API crashes at
    boot").
- Applicable skills: `typescript-expert`.
- Definition of done: `cd mcp && npm run typecheck` clean with the new alias;
  the stdio MCP server (`npm run dev`) still starts, still returns 5 tools, and
  `mcp/src/tools/**` + `mcp/src/server.ts` + `mcp/src/index.ts` contain **zero**
  imports of `@devdigest/reviewer-core` or `server/src` (the alias is used only
  under `mcp/src/cli*`).

**WI11. Reuse `parseUnifiedDiff` instead of writing a second parser.**
- Current location: `server/src/adapters/git/diff-parser.ts`, imported at five
  sites (`server/src/adapters/index.ts`, `server/src/adapters/mocks.ts`,
  `server/src/adapters/git/simple-git.ts`,
  `server/src/modules/reviews/diff-loader.ts`, `server/test/grounding.test.ts`).
  It is a pure string→`UnifiedDiff` function with no I/O.
- Recommended: move the implementation to `reviewer-core/src/diff/parse.ts`,
  export `parseUnifiedDiff` from `reviewer-core/src/index.ts`, and reduce
  `server/src/adapters/git/diff-parser.ts` to a one-line re-export
  (`export { parseUnifiedDiff } from '@devdigest/reviewer-core';`) — so all five
  existing server import sites keep working **unchanged**, satisfying
  `reviewer-core/AGENTS.md`'s "update both `src/index.ts` and every import site"
  rule with the minimum churn.
- Note: the alternative of aliasing the single `server/src` file from `mcp/` is
  now **ruled out** by the WI10 decision — the CLI never imports `server/src`.
- Files/modules: `reviewer-core/src/diff/parse.ts` (new),
  `reviewer-core/src/index.ts`, `server/src/adapters/git/diff-parser.ts`.
- Applicable skills: `typescript-expert`.
- Definition of done: `cd reviewer-core && npm run typecheck && npm test`,
  `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` (incl.
  `test/grounding.test.ts`) all green with **no** edits to the five call sites.
- **See Open Q7** (narrowed).

**WI12. The CLI itself.**
- Files/modules (new, all under `mcp/src/`):
  - `cli.ts` — the entrypoint. Arg parsing via node's built-in
    `util.parseArgs` (zero new deps). Supports `review --mode <mode>`,
    `--agent-file <path>`, `--json`, `--help`. Owns the process exit code and
    nothing else.
  - `cli/repo.ts` — `git rev-parse --show-toplevel` → repo root;
    `git diff HEAD` → raw diff; `git ls-files --others --exclude-standard` →
    untracked files, for the warning below. Uses `node:child_process`
    `execFile` (no `simple-git` dependency).
  - `cli/modes.ts` — `MODES: Record<ReviewMode, DiffCollector>` where
    `ReviewMode = 'working' | 'staged' | 'branch'`. Only `working` is
    implemented; `staged` and `branch` are **registered and listed in
    `--help`** and return an explicit "not implemented yet" failure — the same
    listed-stub convention `get_blast_radius` established in this package
    (`docs/plans/mcp-server.md` WI7). Adding a mode later = one entry here.
  - `cli/agent.ts` — resolves the review agent config without a DB.
    **Decision (user, 2026-08-08): approved as proposed** — a default config
    shipped as a constant in this file (`name`, `model`, `system_prompt`,
    `strategy`, `ci_fail_on`), overridable with `--agent-file <path.json>`
    parsed with the existing `AgentManifest` schema from `@devdigest/shared`
    (**JSON, not YAML** — no new dependency; nothing in this repo currently
    reads or writes the `.devdigest/agents/<slug>.yaml` form that
    `AgentManifest`'s docblock describes).
  - `cli/llm.ts` — reads `~/.devdigest/secrets.json` (JSON; stored value wins
    over `process.env`, mirroring `LocalSecretsProvider`'s precedence
    **without importing it**), then constructs
    `new OpenRouterProvider(key)` from `@devdigest/reviewer-core`. A missing
    key is a clean, actionable message + exit 2 — never a stack trace, never
    an echoed key.
  - `cli/report.ts` — terminal rendering: one line per finding with
    `SEVERITY  path:line  title`, then the rationale, then a summary line
    (`N findings — X critical, Y warning, Z suggestion`).
- Pipeline (no second implementation — this is the core requirement):
  `git diff HEAD` → `parseUnifiedDiff` (WI11) → `reviewPullRequest({ systemPrompt, model, diff, llm, strategy, task })`
  → `outcome.review.findings` (already citation-grounded by the engine) →
  `countBlockers(findings, ciFailOn)` from `@devdigest/reviewer-core` — the same
  helper `server/src/modules/reviews/run-executor.ts` uses, so "blocking" means
  exactly what it means in the web UI.
- **Exit-code contract (documented verbatim in `--help`):**
  `0` = review ran and produced no blocking findings ·
  `1` = review ran and produced ≥1 blocking finding (severity ≥ the agent's
  `ci_fail_on`) · `2` = the review could not run (not a git repo, no diff
  source, missing API key, LLM/network failure, unimplemented mode).
- **Untracked files:** `git diff HEAD` covers staged + unstaged changes to
  **tracked** files only. Untracked files are **excluded**; `--help` says so,
  and the run prints a stderr warning naming them
  (`git ls-files --others --exclude-standard`) so the gap is never silent.
- stdout is the human report; diagnostics/warnings go to stderr. This is a
  *different* entrypoint from `src/index.ts` and is **not** bound by the stdio
  "stdout is the protocol channel" rule — record that in `mcp/AGENTS.md`.
- Applicable skills: `typescript-expert`, `zod` (`AgentManifest` parsing +
  arg validation), `security` (never print/log the API key; never read or send
  gitignored/untracked content; treat the diff as untrusted input — the engine
  already delimiter-wraps it).
- Definition of done: from a dirty working tree in any git repo, the documented
  invocation (WI13) prints findings with severity + path + line and exits per
  the contract, **with the API server and Postgres stopped**; `--mode staged`
  exits non-zero with a clear message;
  `grep -r "reviewPullRequest\|assemblePrompt\|groundFindings" mcp/src` shows
  the engine is called, never reimplemented.

**WI13. Package wiring for the CLI.**
- Files/modules: `mcp/package.json` — add `"review": "tsx src/cli.ts review --mode working"`
  to `scripts`; `bin` wiring mechanics are Open Q8 (a `.ts` file cannot be a
  `bin` target under plain `node`, so a real `bin` needs a small JS shim that
  re-execs `tsx`). Optionally `scripts/review.sh` at the repo root, mirroring
  the existing `scripts/mcp-on.sh` / `mcp-off.sh` style.
- Applicable skills: none.
- Definition of done: a documented one-liner that works today from a clean
  checkout (`cd mcp && npm ci && npm run review`), with the pre-push usage
  spelled out in `mcp/README.md`.

**WI14. Tests + CI lane for both parts.**
- Files/modules:
  - `server/test/blast-service.test.ts` — hermetic unit test of the blast
    service with a fake `RepoIntel` (via `ContainerOverrides.repoIntel`) and a
    fake repository: happy path, `partial` index → `status: 'partial'` + a
    non-empty `reason`, empty `pr_files` → `degraded` (not an empty-but-`full`
    response), and 404 on a foreign workspace. Model it on
    `server/test/smart-diff-service.test.ts`.
  - `server/test/repo-intel-*` — WI1's per-symbol cap test (see WI1's DoD);
    the existing degraded-facade coverage stays green.
  - `client/src/app/.../\_components/BlastTab/BlastTab.test.tsx` — RTL:
    renders symbols/callers/endpoints; renders the degraded banner with the
    server's `reason`; a caller row's `file:line` is a link to the expected
    `githubBlobUrl`.
  - `mcp/test/get-blast-radius.test.ts` — rewritten (WI7).
  - `mcp/test/cli-*.test.ts` — hermetic: inject a fake git-exec and a fake
    `LLMProvider` (no network, no real repo). Cover: diff → findings → exit 0;
    a blocking finding → exit 1; engine failure → exit 2; `--mode staged` →
    non-zero + "not implemented"; untracked-file warning text present.
  - `.github/workflows/mcp.yml` — add `reviewer-core/**` to both `paths:`
    filters and an **"Install reviewer-core deps"** step
    (`working-directory: reviewer-core`, `run: npm ci`) before
    `npm run typecheck` / `npm test`. Copy the rationale comment from
    `.github/workflows/server-unit.yml`, which already documents exactly this
    ("that source imports `openai`/`zod`, so without reviewer-core's deps
    installed, tsc fails with TS2307").
- Applicable skills: `react-testing-library` (the `BlastTab.test.tsx` only —
  it does not apply to the server or mcp suites).
- Definition of done: every command in the Test plan below is green (modulo the
  documented pre-existing flake); `mcp.yml` passes with Docker stopped.

**WI15. Docs.**
- Files/modules:
  - `server/src/modules/repo-intel/README.md` — Blast Radius (L04) is now
    wired; add `GET /pulls/:id/blast` to the routes list **and** WI4's
    endpoint-depth paragraph. The facade method list is unchanged (no new
    methods).
  - `server/README.md` — API map entry.
  - `client/README.md` — UI route map: the 4th tab.
  - `mcp/AGENTS.md` — Map (new `src/cli.ts`, `src/cli/*`); **one explicit
    sentence** stating that the pre-push CLI is a documented, deliberate
    exception to "HTTP-only, never in-process" — it may import
    `@devdigest/reviewer-core` because it is a one-shot process that never
    touches `server/src`, and this is **not** a precedent for the 5 MCP tools,
    whose design is unchanged; the stdout rule scoped to the stdio server, not
    the CLI; the stack line (this package's CLI path touches git + an LLM
    provider + the local secrets file, while the tool path still touches
    none of them); `get_blast_radius` no longer a stub.
  - `mcp/README.md` — a CLI section: usage, `--mode` matrix, the exit-code
    contract, the untracked-file caveat, where the API key comes from, and that
    **no server or database is required**.
  - Root `AGENTS.md` — the packages table's `mcp/` description (it currently
    says only "stdio MCP server exposing review tools").
  - `TESTING.md` — the `mcp` suite row's "hermetic, `fetch` stubbed" wording
    now also covers stubbed git + a stubbed LLM provider.
- Applicable skills: `mermaid-diagram` (only if a README architecture diagram
  actually changes — root `README.md`'s diagram already has
  `MCP -->|REST| API`, which stays true; the CLI's `reviewer-core` edge would
  be a new arrow).
- Definition of done: a cold reader can run the CLI and the Blast tab from the
  docs alone, and `mcp/AGENTS.md` no longer contains a rule the CLI appears to
  break.

### Test plan

Commands taken from each package's own `AGENTS.md` / `TESTING.md` — not invented:

```sh
# server
cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'   # unit, no Docker
cd server && pnpm typecheck
cd server && pnpm arch:check                                    # WI2's onion boundary
cd server && pnpm exec vitest run .it.test                      # integration, needs Docker

# client
cd client && pnpm test          # bare `test` — NEVER `pnpm test run` (client/INSIGHTS.md)
cd client && pnpm typecheck

# reviewer-core (touched by WI11)
cd reviewer-core && npm run typecheck
cd reviewer-core && npm test

# mcp (both the tool and the CLI)
cd mcp && npm run typecheck
cd mcp && npm test
```

Notes for whoever runs these:
- `pnpm <script>` can abort with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`
  in this Windows shell (root `INSIGHTS.md`). Fall back to
  `./node_modules/.bin/vitest.cmd run --exclude '**/*.it.test.ts'` and
  `./node_modules/.bin/tsc.cmd --noEmit -p tsconfig.json`.
- **`cd server && pnpm typecheck` should now be CLEAN.** The 3 long-standing
  errors in `server/src/modules/orders/orders.ts` were fixed outside this plan
  (2026-08-08): that file is a deliberately-fake fixture package
  (`payments-api-fixture`, simulating the seeded `acme/payments-api`, imported
  by nothing real) that `server/tsconfig.json`'s `include: ["src/**/*.ts"]` was
  sweeping into typecheck; an `"exclude": ["src/modules/orders/**"]` entry was
  added. Any typecheck error you see is therefore **yours** — the old "3
  pre-existing errors" caveat in `server/INSIGHTS.md` is now stale and should
  be corrected at session end (`engineering-insights` skill).
- `server/test/indexer-pipeline.test.ts` has **6 known Windows-only flakes**
  (`server/INSIGHTS.md`). Check `git status` on the file before treating a
  failure there as a regression.
- Server integration tests need Docker, which is **not auto-started** here
  (root `INSIGHTS.md`). Check `docker ps` first; if it's down, say so rather
  than claiming a live check.
- **Live blast verification requires a repo that is actually cloned and
  indexed.** Do **not** use the seeded `acme/payments-api` — its
  `clone_path` is `null`, so there is no index and blast will be permanently
  degraded (`server/INSIGHTS.md`). Check
  `GET /repos/:id/index-state` reports `full` or `partial` first. The devDigest
  repo itself is a known-good target (`server/INSIGHTS.md` confirms
  `repoIntel` returns real paths for it).
- **Live CLI verification is the honest test of Part 2's premise:** run it with
  the API server **and Postgres stopped**. If it needs either, WI10's whole
  rationale has failed.

### Risks / Open questions

Items marked **RESOLVED** carry a user decision — implement them as written, do
not re-open. Items marked **OPEN** must **not** be silently resolved by
`implementer`; surface them to the user before or during the affected work item.

1. **RESOLVED — where to fix the caller-cap bug: in `repo-intel`.**
   (User, 2026-08-08.) `tryPersistentBlast`'s global sort+slice and the ripgrep
   fallback's uncapped, unsorted output are both fixed in
   `server/src/modules/repo-intel/service.ts` so the cap and rank sort apply
   **per changed symbol**, matching `MAX_CALLERS_PER_SYMBOL`'s own doc comment.
   This is a **required** bug fix, not optional polish, and its Definition of
   done includes the >20-callers-on-one-symbol test (WI1).
2. **RESOLVED — reuse the existing endpoint detection; build no reverse
   import-graph BFS.** (User, 2026-08-08.) WI4 verifies what the existing
   mechanism does and documents its depth rather than extending it. **Residual
   known gap, now documented rather than closed:** endpoints are found only in
   files that **directly** call a changed symbol; an endpoint two call-hops away
   is not reported. Whether that gap is worth closing later is a future
   decision, deliberately deferred.
3. **OPEN — `status` semantics for a `partial` index.**
   `RepoIntelRepository.tryGetIndexState` deliberately does **not** flag
   `status: 'partial'` as degraded ("'partial' is still a working index — no
   degraded flag"), while `tryPersistentBlast` happily serves from a `partial`
   index with `degraded: false`. This plan surfaces `partial` as its own
   response status with an explanation, which is what requirement #6 asks for —
   but it means the Blast tab will show a warning banner in situations the rest
   of the app currently treats as fine. Confirm that's wanted before shipping
   the banner.
4. **RESOLVED — CLI agent-config source.** (User, 2026-08-08.) A default agent
   config shipped in `mcp/src/cli/agent.ts`, overridable via
   `--agent-file <path.json>` parsed with the existing `AgentManifest` contract.
   JSON, not YAML — no new dependency. The `.devdigest/agents/<slug>.yaml` form
   `AgentManifest`'s docblock describes stays a trivial follow-up if the course
   later builds the CI export (nothing in this repo reads or writes it today).
5. **OPEN — the optional LLM explanation (WI8): build now or defer?** It is
   explicitly a stretch goal, it costs a token budget on every blast view, and
   the deterministic `summary` already fills the contract's required `summary`
   field. **Recommendation: defer**, leaving `POST /pulls/:id/blast/explain` as
   the documented shape for later.
6. **RESOLVED — in-process `reviewer-core` for the CLI, MCP concept unchanged.**
   (User, 2026-08-08: "задум MCP не міняємо".) The 5 MCP tools' design is
   untouched — still HTTP-only, still no secrets, still no LLM calls, still no
   `server/src` import. The pre-push CLI is a **separate additive entry point**
   in the same package (its own `src/cli.ts` + `src/cli/`, its own invocation),
   not an MCP tool and not reachable over the MCP stdio protocol; for that
   module only, importing `@devdigest/reviewer-core` in-process is approved
   (feasibility verified by probe, WI10). **The cost to acknowledge:** the
   package's *CLI path* now reads `~/.devdigest/secrets.json` and makes real
   LLM calls, so `security` applies to WI12 and `mcp/AGENTS.md`'s stack /
   description lines must be updated (WI15) — while the *tool path*'s posture is
   unchanged. WI15 must state in one sentence that this is a deliberate,
   documented exception and **not** a precedent for the 5 tools.
7. **OPEN (narrowed) — relocating `parseUnifiedDiff` into `reviewer-core`
   (WI11).** It touches `reviewer-core`'s public API, which
   `reviewer-core/AGENTS.md` calls out as a coordinated change. The recommended
   one-line re-export from `server/src/adapters/git/diff-parser.ts` keeps all
   five existing server call sites untouched. Decision 6 has **ruled out** the
   previously-listed alternative (aliasing the single `server/src` file from
   `mcp/`), and duplicating the parser is barred by the "no second
   implementation" requirement — so the only remaining question is whether the
   user accepts the small `reviewer-core` public-API addition. Confirm before
   editing `reviewer-core/src/index.ts`.
8. **OPEN (narrowed) — `bin` wiring mechanics (WI13).** The coordinator's
   restatement of decision 6 describes the CLI as having "its own `bin`
   wiring", so a `bin` entry appears to be expected — but *how* is still
   undecided and is a real fork for an implementer: `mcp/package.json` has
   `noEmit: true` and no build step, and a `.ts` file cannot be a `bin` target
   under plain `node`. So a real `bin` needs a small committed JS shim
   (`mcp/bin/devdigest.js`) that re-execs `tsx src/cli.ts`. Options: (a) ship
   that shim + `"bin": {"devdigest": "bin/devdigest.js"}` now; (b) ship only the
   npm script + documented `npx tsx mcp/src/cli.ts review --mode working` and
   add the `bin` later. Ask before writing the shim.
9. **ACTION — `mcp/INSIGHTS.md` is wrong and should be corrected (planner
   cannot edit it).** Its "What Works" third bullet asserts that a stray
   **value** import from `@devdigest/shared` "would typecheck fine and then
   crash at spawn with `ERR_MODULE_NOT_FOUND`". Verified false this session: a
   probe file in `mcp/src/` doing `import { Review } from '@devdigest/shared'`
   ran cleanly under `mcp/node_modules/.bin/tsx` and printed a working
   `Review.parse`. `tsx` resolves `tsconfig.json`'s `paths` at runtime — which
   is exactly how `server/` (`tsx watch src/server.ts`) has always imported the
   same vendored contracts as values. The *stdio-spawn verification technique*
   the bullet recommends is still worth keeping; the failure mode it predicts is
   not real. `implementer` should correct that entry at session end
   (`engineering-insights` skill) — WI10 depends on the corrected fact.
10. **ACTION — `server/INSIGHTS.md`'s "3 pre-existing typecheck errors in
    `orders.ts`" entry is now stale.** Fixed outside this plan on 2026-08-08 via
    `"exclude": ["src/modules/orders/**"]` in `server/tsconfig.json` (the file is
    a fake `payments-api-fixture` package that `include: ["src/**/*.ts"]` was
    sweeping in). Correct that Recurring Errors & Fixes entry at session end.
11. **INFO — vendor-mirror edit (WI3).** Editing
    `server/src/vendor/shared/contracts/review-api.ts` + hand-copying to
    `client/` is the repo's documented convention, with direct precedent
    (`SmartDiffResponse`, `PrIntentRecord`, the `risk_areas` addition in
    `brief.ts` — `server/INSIGHTS.md` 2026-08-07). Called out anyway because
    `*/src/vendor/**` reads as "do-not-touch" at a glance and there is no
    tooling to catch a missed mirror.

### Explicitly out of scope

Architecture review and security review are owned by separate agents — see
`agents/README.md`#handoff-chain.
