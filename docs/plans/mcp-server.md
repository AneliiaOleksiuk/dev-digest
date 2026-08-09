# Development Plan: local-only MCP server (`@devdigest/mcp`, stdio)

### Objective

Add a new standalone package `mcp/` that exposes DevDigest's existing review
capabilities to an MCP client (Claude Code / Claude Desktop) over **stdio**, as
five callable Tools: `list_agents`, `run_agent_on_pr`, `get_findings`,
`get_conventions`, `get_blast_radius` (stub). The server is a thin, token-frugal
façade over the already-running local Fastify API on `:3001` — no new data model,
no new review logic, no reimplementation of the Conventions Extractor.

### Scope

- **Packages/modules touched:**
  - **NEW** `mcp/` — the whole deliverable (own `package.json` + lockfile +
    `tsconfig.json`, per the repo's "not a monorepo" rule).
  - `server/` — **read-only reuse of its HTTP API**. No `server/src` edits.
  - Root docs: `AGENTS.md` (packages table + docs index), `README.md`
    (packages table + architecture diagram), `TESTING.md` (suite map).
  - **NEW** `.github/workflows/mcp.yml`, **NEW** root `.mcp.json`.
- **Explicitly out of scope:**
  - Any change under `server/src/**`, `client/src/**`, `reviewer-core/src/**`,
    `e2e/**`. If a work item seems to need a server route change, stop and flag
    it — the whole point is that the API surface is already sufficient.
  - Implementing blast-radius analysis (tool #5 is a deliberate stub).
  - HTTP/SSE transport, remote hosting, auth, OAuth — stdio only, confirmed.
  - Converting any of the four read tools into MCP **Resources** (see
    Constraints → "Tools, not Resources").
  - Migrations, schema changes, new contracts in `server/src/vendor/shared/**`.

### Constraints

**From root `AGENTS.md`:**
- "Not a monorepo." Each package installs and runs independently; cross-package
  sharing goes through **tsconfig path aliases**, never npm/workspace deps.
  `mcp/` must follow this exactly — no root `package.json`, no workspace field.
- `@devdigest/shared` lives at `server/src/vendor/shared/` and is hand-mirrored.
  `mcp/` must **not** create a third vendor copy; it aliases the server's copy
  (same trick `reviewer-core/tsconfig.json` already uses, verified there:
  `"@devdigest/shared": ["../server/src/vendor/shared/index.ts"]`).
- **Do-not-touch:** `*/src/vendor/**`, `*/src/db/migrations/**`. Nothing in this
  plan edits either.
- **Secrets never live in git or the database** — `~/.devdigest/secrets.json`
  (mode 0600) with `process.env` fallback. The MCP server needs **zero**
  credentials: every LLM/GitHub key is held by the API process it calls. No
  tool response may echo a secret, and the MCP package must never read the
  secrets file.

**From `server/AGENTS.md` + verified in code:**
- `reapStaleRuns()` on boot "assumes a **single** API process — no multi-replica
  safety" (`server/src/app.ts`, awaited before `listen`). This is the decisive
  argument against the in-process option in Work Item 2 below.
- No route-level auth exists: `getContext()`
  (`server/src/modules/_shared/context.ts`) delegates to
  `LocalNoAuthProvider` (`server/src/adapters/auth/local.ts`), which always
  returns the default workspace + system user. Grep for `preHandler`/`apiKey`
  in `server/src` finds no auth middleware. **Confirms the prior research: the
  MCP server needs no credential to call `localhost:3001`.** CORS
  (`origin: [config.webOrigin]`) is a browser-only control and does not affect
  a Node `fetch` client.
- Global rate limit is 120 req/min; `POST /pulls/:id/review` and
  `POST /pulls/:id/intent` are additionally capped at **10/min**. The polling
  loop in Work Item 4 must stay well under 120/min (2 s interval = 30/min).

**From root `INSIGHTS.md`:**
- `reviewer-core/` is on npm, everything else on pnpm — "a known, harmless
  inconsistency, not a bug to fix reflexively." Relevant to the package-manager
  choice in Work Item 1.
- `pnpm <script>` can abort with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`
  in this Windows shell; workaround is calling `./node_modules/.bin/<bin>`
  directly. Applies to running the new suite locally.
- Docker Desktop is not auto-started here — any live end-to-end check of this
  MCP server needs Postgres + `pnpm dev` up first; otherwise fall back to
  typecheck + unit suite and say so.

**From `server/INSIGHTS.md`:**
- The seeded demo repo `acme/payments-api` has `clone_path: null`, so its
  PR #482 always yields an **empty diff** — do not use it as the live smoke
  target for `run_agent_on_pr`; a run there completing with 0 findings is the
  documented environment quirk, not a bug in this MCP server.
- "A run that completes instantly with `findings_count: 0` and a summary saying
  the diff is empty means the local git diff failed silently" — the same trap
  applies when smoke-testing through MCP.

**Tools, not Resources (design rationale, not an open question):** general MCP
guidance would push the four pure reads toward Resources (cacheable, lighter).
The course design deliberately keeps all five as **Tools** because the
error-recovery contract ("agent not found, call `list_agents`") is a
model-facing, Tools-only affordance. This is settled — do not convert any tool
to a Resource, and do not re-open it during implementation.

**Onion architecture:** the `onion-architecture` skill and its `arch:check`
enforcement are scoped to **new folders under `server/src/modules/`**
(`server/.dependency-cruiser.cjs` runs against `src`). It does **not** bind
`mcp/`. Its shape (transport → service → port) is still the reference layout
for the new package; there is no automated boundary check for `mcp/` and none
is being added.

### Work items

1. **Create the `mcp/` package skeleton (npm + vitest + tsx, stdio entry).**
   - Files/modules:
     - `mcp/package.json` — `{"name":"@devdigest/mcp","private":true,
       "type":"module"}`, scripts `dev` (`tsx src/index.ts`), `start`,
       `typecheck` (`tsc --noEmit -p tsconfig.json`), `test` (`vitest run`).
       Deps: `@modelcontextprotocol/sdk`, `zod` pinned `^3.24.1` (matches the
       vendored contracts' zod). Dev deps mirroring `reviewer-core`:
       `@types/node ^22`, `tsx ^4.19`, `typescript ^5.7`, `vitest ^2.1`.
     - `mcp/package-lock.json` — **npm**, matching `reviewer-core/` and `e2e/`,
       the two leaf/tooling packages. Rationale: the MCP server is spawned as a
       child process by an external client, so a dead-simple `npx tsx`/`node`
       invocation matters more than pnpm parity, and root `INSIGHTS.md`
       documents pnpm aborting non-interactively in this exact shell. See
       Risks — confirm with the user before locking this in.
     - `mcp/tsconfig.json` — copy `reviewer-core/tsconfig.json`'s compiler
       options (ES2022 / ESNext / Bundler / strict / `noUncheckedIndexedAccess`)
       with `paths: {"@devdigest/shared": ["../server/src/vendor/shared/index.ts"],
       "@devdigest/shared/*": ["../server/src/vendor/shared/*"]}`.
       **All `@devdigest/shared` imports in `mcp/` must be `import type`** so
       the alias is erased at compile time and nothing has to resolve it at
       runtime under `tsx`.
     - `mcp/vitest.config.ts` (mirror `reviewer-core/vitest.config.ts`).
     - `mcp/README.md`, `mcp/AGENTS.md`, `mcp/CLAUDE.md` (`@AGENTS.md`),
       `mcp/INSIGHTS.md` — every existing package has all four; match their
       structure (map / non-default conventions / gotchas / do-not-touch).
     - `mcp/src/index.ts` — the only stdio-touching file: construct the server
       from `createMcpServer()` and `connect(new StdioServerTransport())`.
   - Applicable skills: `typescript-expert` (tsconfig/ESM/`import type`),
     `zod` (schema authoring, see WI3).
   - Definition of done: `cd mcp && npm run typecheck` passes; `npm run dev`
     starts and stays alive on stdio without writing anything to **stdout**.

2. **Decide + implement the API access path: HTTP to `localhost:3001` (not
   in-process imports).**
   - Files/modules: `mcp/src/api-client.ts`.
   - Decision and justification (do not revisit during implementation):
     - **In-process is unsafe here.** Importing
       `server/src/modules/reviews/service.ts` would force `mcp/` to build its
       own `Container` + Drizzle `Db` + `loadConfig()` — a second API-shaped
       process against the same database. `server/src/app.ts` awaits
       `reapStaleRuns()` on boot and its own comment states the single-instance
       assumption; a second process would mark the *live* server's in-flight
       runs as orphaned.
     - `ReviewRunExecutor` streams over the **in-memory** `container.runBus`
       (`server/src/modules/reviews/service.ts`); a separate process cannot
       observe the running server's bus at all.
     - The HTTP API is already the sanctioned seam — `client/src/lib/api.ts`
       consumes exactly these endpoints. Reusing it keeps `mcp/` outside the
       server's module boundaries entirely (no cross-package import of a
       service or repository).
   - Implementation: one small `fetch` wrapper. Base URL from
     `DEVDIGEST_API_BASE` env, defaulting to `http://localhost:3001` (mirrors
     `client/.env.example`'s `NEXT_PUBLIC_API_BASE`). Parse the server's error
     envelope `{error:{code,message}}` (shape set in `server/src/app.ts`'s
     `setErrorHandler`) into a typed `ApiError{status, code, message}`; never
     forward a raw response body. Connection refused maps to the
     "is the API running?" message in WI6.
   - Applicable skills: `typescript-expert`, `security` (no credential
     handling, no secret echo, no raw-body forwarding).
   - Definition of done: every endpoint call in WI4/WI5 goes through this one
     module; `mcp/src` contains zero imports from `server/src` other than
     `import type … from '@devdigest/shared'`.

3. **Define the flat input + compact output schemas for all five tools.**
   - Files/modules: `mcp/src/schemas.ts`.
   - Inputs — **flat scalars only, no nested objects** (principle #2):
     - `list_agents` → `{}` (no args).
     - `run_agent_on_pr` → `{ repo: string, pr: number, agent: string }`
       (`repo` = `"owner/name"`, matched against `Repo.full_name` from
       `server/src/vendor/shared/contracts/platform.ts`; `pr` = the GitHub PR
       **number**, not the internal uuid; `agent` = the `id` returned by
       `list_agents`).
     - `get_findings` → `{ repo: string, pr: number, agent?: string }` —
       deliberately the *same* argument vocabulary as `run_agent_on_pr` so the
       model never has to carry a run id around; `agent` omitted = the latest
       completed review on that PR by any agent.
     - `get_conventions` → `{ repo: string }`.
     - `get_blast_radius` → `{ repo: string, pr: number }` (declared even
       though unimplemented — see WI7).
   - Outputs — compact, hand-built, **never** the raw DB record (principle #3):
     - `AgentSummary` = `{ id, name, description, model }`, projected from the
       `Agent` contract (`contracts/knowledge.ts`). Dropped on purpose:
       `system_prompt` (can be kilobytes), `output_schema`, `version`,
       `strategy`, `ci_fail_on`, `repo_intel`, `provider`.
     - `VerdictResult` = `{ verdict, score, summary, run_id, findings[] }`,
       projected from `ReviewRecord` (`contracts/review-api.ts`). `verdict`
       reuses the existing `Verdict` enum (`contracts/findings.ts`).
     - `CompactFinding` = `{ severity, file, lines, title, rationale,
       suggestion }` where `lines` is a pre-formatted `"42"` / `"42-58"`
       string. Projected from `FindingRecord`; dropped on purpose: `id`,
       `review_id`, `category`, `confidence`, `kind`, `trifecta_components`,
       `evidence`, `accepted_at`, `dismissed_at`.
     - `ConventionSummary` = `{ category, rule, evidence, status }` where
       `evidence` is `"path:line"`, projected from `ConventionCandidate`
       (`contracts/knowledge.ts`). Dropped: `id`, `evidence_snippet`,
       `confidence`, `skill_id`.
   - Deliberate deviations from the literal `{verdict, findings[]}`, each
     justified once here and nowhere else: `score` (one integer, the UI's
     headline number), `summary` (the agent's own prose — a verdict with no
     prose is unusable), `run_id` (one short string; the only handle a human
     has to open the run's trace in the web UI). Nothing else is added.
   - Findings cap: sort `findings` CRITICAL → WARNING → SUGGESTION and cap at
     `MAX_FINDINGS = 50`; when capped, add `omitted_findings: <n>` (present
     only when > 0). Directly serves principle #3's "one bloated response can
     burn tens of thousands of tokens."
   - Tool descriptions: one short single-purpose sentence each, no embedded
     examples, no schema fragment repeated across tools.

     **Final descriptions — use verbatim, do not paraphrase:**

     | Tool | Description |
     |---|---|
     | `list_agents` | "List the reviewer agents configured in this DevDigest workspace. Returns each agent's id, name, description, and model — the id is required by run_agent_on_pr and get_findings." |
     | `run_agent_on_pr` | "Run a code review on a pull request using the given agent, wait for it to finish, and return the verdict with findings. Args: repo (owner/name), pr (PR number), agent (id from list_agents)." |
     | `get_findings` | "Get the verdict and findings from the most recent completed review of a pull request. Use after run_agent_on_pr, or to check a review someone else already ran." |
     | `get_conventions` | "Get this repository's extracted coding conventions — the same house rules used to ground agent reviews." |
     | `get_blast_radius` | "Not implemented yet. Will return the blast radius (impact map) of a pull request's changes. Calling it now returns an explanatory error — use run_agent_on_pr or get_conventions instead." |
   - Applicable skills: `zod`, `typescript-expert`.
   - Definition of done: every tool handler's return value `.parse()`s against
     its declared output schema (asserted by the test in WI9.8); no input
     schema contains an object- or array-typed property.

4. **Implement `run_agent_on_pr` as one synchronous outcome (principle #1).**
   - Files/modules: `mcp/src/tools/run-agent-on-pr.ts`, `mcp/src/resolve.ts`.
   - Resolution chain (`resolve.ts`, shared with WI5):
     - `repo` → `GET /repos`, match `full_name` case-insensitively → repo uuid.
     - `pr` → `GET /repos/:repoId/pulls`, match `number` → pull uuid. (Note:
       this endpoint also syncs from GitHub when a token is configured and
       degrades gracefully offline — `server/src/modules/pulls/routes.ts`.)
     - `agent` → `GET /agents`; accept an exact `id` match first, then fall
       back to a case-insensitive `name` match (models routinely pass the human
       name); anything else → the WI6 "call `list_agents`" error.
   - The three internal steps, inside this one tool:
     1. `POST /pulls/:pullId/review` with `{agentId}` → `ReviewRunResponse`;
        take `runs[0].run_id`. (`reviews` comes back empty — `runReview()` in
        `server/src/modules/reviews/service.ts` is fire-and-forget by design.)
     2. Poll `GET /pulls/:pullId/runs` every **2000 ms** until the row with that
        `run_id` reaches a terminal `status`. Terminal values, read from
        `run-executor.ts`: `done` | `failed` | `cancelled` (in-flight:
        `running`). Prefer polling over the SSE stream at `GET /runs/:id/events`
        — a stdio child process has no `EventSource`, and polling survives
        reconnects; 30 req/min stays far under the 120/min global cap.
     3. On `done`: `GET /pulls/:pullId/reviews` → pick the `ReviewRecord` whose
        `run_id` matches → project to `VerdictResult` per WI3.
   - Timeout: `DEVDIGEST_MCP_RUN_TIMEOUT_MS`, default **180000** (3 min). On
     expiry return the WI6 timeout error (not a crash, not a fake success).
   - **Client-timeout mitigation:** a multi-minute blocking tool can exceed the
     MCP client's own per-call timeout. Send an SDK progress notification on
     each poll tick (elapsed seconds + run status) — progress resets the
     client's timeout window — and document in `mcp/README.md` that Claude Code
     users may also need to raise `MCP_TIMEOUT`/`MCP_TOOL_TIMEOUT`.
   - Annotations: `readOnlyHint: false`, `destructiveHint: false`,
     `idempotentHint: false`, `openWorldHint: true` (it reaches GitHub + an LLM
     provider). This is the only tool with side effects — it creates an
     `agent_runs` row.
   - Applicable skills: `typescript-expert`, `zod`, `security` (never surface
     provider keys or raw upstream error bodies from a failed run).
   - Definition of done: a single tool call, given `(repo, pr, agent)`, returns
     a populated `VerdictResult` with no follow-up call required; the model is
     never handed an intermediate run id as a required next step.

5. **Implement the three other real tools as pure reads.**
   - Files/modules: `mcp/src/tools/list-agents.ts`,
     `mcp/src/tools/get-findings.ts`, `mcp/src/tools/get-conventions.ts`.
   - `list_agents`: `GET /agents` → `AgentSummary[]`. This is the **in-app,
     DB-backed reviewer agents** module (`server/src/modules/agents/`) — *not*
     the `agents/*.md` dev-tooling personas, which are a separate system (see
     `agents/README.md`). Its `id` is the value `run_agent_on_pr`/`get_findings`
     consume.
   - `get_findings`: resolve repo + pr via `resolve.ts`, then
     `GET /pulls/:pullId/reviews`; filter `kind === 'review'`, filter by
     `agent_id`/`agent_name` when `agent` was passed, take the newest by
     `created_at`, project to `VerdictResult`. No review found → the WI6
     "call `run_agent_on_pr` first" error.
   - `get_conventions`: **thin wrapper, no reimplementation** — resolve repo,
     then `GET /repos/:repoId/conventions`
     (`server/src/modules/conventions/routes.ts`) → `ConventionSummary[]`.
     Do **not** call `POST /repos/:id/conventions/extract` (it costs an LLM
     call and rewrites unpromoted rows via `deleteUnpromoted`) — an empty list
     is a legitimate result, returned as a normal (non-error) response with a
     short `note` pointing at the extract action in the web UI.
   - Annotations for all three: `readOnlyHint: true`, `openWorldHint: false`.
     Omit `destructiveHint`/`idempotentHint` — per the MCP spec they are only
     meaningful when `readOnlyHint` is false, so including them is dead schema
     tokens.
   - Applicable skills: `typescript-expert`, `zod`.
   - Definition of done: none of the three issues a `POST`/`PATCH`/`DELETE`;
     each returns its compact projection, never a passthrough of the API body.

6. **Implement the shared "error that leads forward" convention (principle #4).**
   - Files/modules: `mcp/src/errors.ts` (single `toolError(message, nextStep)`
     helper returning a normal `CallToolResult` with `isError: true` and one
     text block — never a thrown protocol-level error).
   - The full case table, applied consistently across all five tools:
     | Case | Message + next action |
     |---|---|
     | API unreachable | `Cannot reach the DevDigest API at <base>. Start it with ./scripts/dev.sh (or cd server && pnpm dev), then retry.` |
     | Unknown `repo` | `Repo "<x>" is not in DevDigest. Known repos: <full_name list>. Add it in the web UI at http://localhost:3000.` |
     | Unknown `pr` | `PR #<n> not found in <repo>. Known PR numbers: <list>.` |
     | Unknown `agent` | `Agent "<x>" not found. Call list_agents to get valid agent ids.` (the verbatim example from principle #4) |
     | No completed review (`get_findings`) | `No completed review for PR #<n> in <repo><by agent X>. Call run_agent_on_pr(repo, pr, agent) first.` |
     | Run finished `failed`/`cancelled` | `Review run <status>: <run.error>. Retry run_agent_on_pr, or open the run in the DevDigest UI.` |
     | Poll timeout | `Review still running after <n>s. It keeps running server-side — call get_findings(repo, pr, agent) in a minute to collect the result.` |
     | `get_blast_radius` | see WI7 |
   - Every message names a concrete next tool call or command. No bare status
     codes, no stack traces, no raw upstream JSON.
   - Applicable skills: `security` (error messages must not leak secrets, file
     paths outside the repo, or provider responses), `typescript-expert`.
   - Definition of done: no tool handler constructs an error result inline —
     all five go through `toolError`; grep for `throw` in `mcp/src/tools/`
     returns nothing.

7. **Implement `get_blast_radius` as an explicit, listed stub.**
   - Files/modules: `mcp/src/tools/get-blast-radius.ts`.
   - It **is** registered and **does** appear in `list_tools`, with the full
     `{repo, pr}` input schema and `readOnlyHint: true`, `openWorldHint: false`,
     so the eventual implementation is a drop-in.
   - It always returns a normal `CallToolResult` with `isError: true` and one
     text block, e.g.: `get_blast_radius is not implemented yet. No blast-radius
     data is available. Use run_agent_on_pr(repo, pr, agent) for a full review,
     or get_conventions(repo) for this repo's house rules.` Never a silent
     success, never a thrown protocol error, never hidden from the tool list.
   - Description must state "not implemented yet" so the model can avoid it
     without paying for a call.
   - Applicable skills: none.
   - Definition of done: `list_tools` returns 5 tools; calling
     `get_blast_radius` yields `isError: true` with the message above and does
     not throw.

8. **Wire the MCP client config + docs.**
   - Files/modules:
     - **NEW** root `.mcp.json` — project-scoped Claude Code config spawning
       `npx tsx mcp/src/index.ts` (or `node`, matching WI1's chosen entry) with
       `DEVDIGEST_API_BASE` documented as an optional env override.
     - `mcp/README.md` — prerequisites (Postgres + API must already be running;
       `./scripts/dev.sh`), the 5 tools, the env vars, and the **stdout is the
       protocol channel** rule (all logging to `stderr`).
     - Root `AGENTS.md` — add `mcp/` to the Packages table (Port column: `—`)
       and a Docs-index line.
     - Root `README.md` — add `mcp/` to the packages table and the architecture
       mermaid diagram (`MCP["mcp/ · stdio"] -->|REST| API`).
     - `TESTING.md` — add an `mcp` row to the suite map (unit / vitest /
       `mcp.yml` / Docker: no) and a `cd mcp && npm test` line under
       "Running locally".
   - Applicable skills: `mermaid-diagram` (the README architecture diagram
     edit only).
   - Definition of done: every existing package-listing surface (root
     `AGENTS.md` table, root `README.md` table + diagram, `TESTING.md` map)
     names `mcp/`; a fresh reader can start the server from `.mcp.json` alone.

9. **Tests + CI lane.**
   - Files/modules: `mcp/test/*.test.ts`, **NEW** `.github/workflows/mcp.yml`.
   - Per `TESTING.md`'s typological philosophy — one happy path plus the edge
     that matters per tool, `fetch` stubbed (no API, no DB, no Docker), exactly
     like the client suite:
     1. `list_agents` maps an `Agent[]` payload to `AgentSummary[]` and drops
        `system_prompt`.
     2. `run_agent_on_pr` happy path: repo→pr→agent resolution, `POST` review,
        two polls (`running` then `done`), reviews fetch, compact result.
     3. `run_agent_on_pr` with an unknown agent → `isError: true` and the text
        contains `list_agents`.
     4. `run_agent_on_pr` poll timeout (fake timers) → `isError: true`, message
        points at `get_findings`, and no exception escapes.
     5. `get_findings` with no completed review → `isError: true` pointing at
        `run_agent_on_pr`.
     6. `get_conventions` maps `ConventionCandidate[]` → `ConventionSummary[]`
        and returns the empty-list `note` when the repo has none.
     7. `get_blast_radius` is present in `list_tools` **and** returns
        `isError: true` with a "not implemented" message.
     8. Contract guard: for each tool, the handler's structured payload
        `.parse()`s against its output schema and contains no dropped field
        (`system_prompt`, `rationale`-less raw rows, `confidence`, …) — this is
        the regression test for principle #3.
   - `.github/workflows/mcp.yml`: `paths:` filter on `mcp/**` **and**
     `server/src/vendor/shared/**` (the type alias target — same cross-package
     alias encoding `TESTING.md` already documents for `reviewer-core` →
     `server-unit`). Jobs: typecheck + `npm test`, npm-based like
     `reviewer-core.yml`.
   - Applicable skills: none (`react-testing-library` does **not** apply — no
     React here).
   - Definition of done: `cd mcp && npm run typecheck && npm test` is green
     with Docker stopped; `mcp.yml` mirrors `reviewer-core.yml`'s structure.

### Test plan

Commands are taken from each package's own AGENTS.md / `TESTING.md`:

```sh
# new package (npm + vitest, matching reviewer-core/ and e2e/)
cd mcp && npm run typecheck
cd mcp && npm test

# regression check that nothing in server/ moved (docs-only changes there)
cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'
cd server && pnpm typecheck
```

Notes for whoever runs these:
- If pnpm aborts with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` (root
  `INSIGHTS.md`), call the binary directly:
  `./node_modules/.bin/vitest run --exclude '**/*.it.test.ts'`.
- `cd server && pnpm typecheck` already reports **3 pre-existing errors** in
  `server/src/modules/orders/orders.ts` (`server/INSIGHTS.md`, Recurring Errors
  & Fixes). Those are not caused by this work.
- `test/indexer-pipeline.test.ts` has 6 known Windows-only flakes
  (`server/INSIGHTS.md`) — check `git status` on the file before treating a
  failure there as a regression.
- Server **integration** tests are not required (no `server/src` change) and
  need Docker, which is not auto-started here.
- A live smoke test (start `./scripts/dev.sh`, point Claude Code at
  `.mcp.json`, call `list_agents` then `run_agent_on_pr`) is **manual and
  optional**: it needs Docker + a working LLM provider key. If run, do **not**
  target the seeded `acme/payments-api` PR #482 — its `clone_path` is null so
  the diff is always empty (`server/INSIGHTS.md`).

### Risks / Open questions

These could not be settled by reading the repo. `implementer` must **not**
silently resolve them — surface them to the user before or during the affected
work item.

1. **Package manager for `mcp/` (WI1) — CONFIRMED: npm.** The repo is
   genuinely split: pnpm for `server`/`client`, npm for `reviewer-core`/`e2e`.
   User confirmed **npm** on 2026-08-08, accepting the plan's recommendation
   (leaf/tooling package, simpler child-process spawn, avoids the documented
   pnpm no-TTY abort on this machine).
2. **`run_agent_on_pr` max-wait (WI4) — CONFIRMED: 180 s default.** User
   confirmed the 180 s / 2 s poll interval default and the env override name
   `DEVDIGEST_MCP_RUN_TIMEOUT_MS` on 2026-08-08, accepting the plan's
   proposal.
3. **Stale route list in the task brief.** The brief cites
   `GET /conventions/:id` as an existing endpoint. It does **not** exist —
   `server/src/modules/conventions/routes.ts` registers
   `POST /repos/:id/conventions/extract`, `GET /repos/:id/conventions`,
   `PATCH /conventions/:id`, `POST /conventions/promote`. WI5 uses only
   `GET /repos/:id/conventions`, so nothing is blocked, but do not go looking
   for the single-convention GET.
4. **`@modelcontextprotocol/sdk` ↔ zod major version.** The vendored contracts
   and every package here are on zod 3 (`^3.24.1`). Newer SDK releases have
   moved toward zod 4 for tool schemas. Verify the installed SDK version's zod
   expectation at install time; if it demands zod 4, keep zod 3 for the
   `@devdigest/shared` **type-only** imports and confine zod 4 to the MCP
   schemas — but flag it, since `server/AGENTS.md` already documents pain from
   two zod module instances ("the error handler does a duck-typed `ZodError`
   check because vendored zod and the api's own zod can be different module
   instances").
5. **`import type` erasure under `tsx` (WI1).** The plan relies on
   `@devdigest/shared` imports being type-only so the tsconfig path alias never
   has to resolve at runtime. If any value import (an enum, a Zod schema)
   sneaks in, the process will fail at spawn with `ERR_MODULE_NOT_FOUND` and
   the MCP client will show only an opaque "server failed to start." Verify
   with an actual `npm run dev` spawn, not just `typecheck`.
6. **`GET /repos/:id/pulls` has a GitHub side effect (WI4).** It syncs PRs from
   GitHub and backfills diff stats for up to 10 PRs per call. It degrades
   gracefully offline, but it means `run_agent_on_pr`'s *resolution* step is
   not purely local. Acceptable (it is the only PR-number → uuid path that
   exists), but worth knowing when `openWorldHint: true` is questioned.
7. **`INSIGHTS.md` freshness.** Nothing read this session looked stale; no
   correction is being requested. `implementer` should add a `mcp/INSIGHTS.md`
   entry (and a root `INSIGHTS.md` session note) at session end per the
   `engineering-insights` skill.

### Explicitly out of scope

Architecture review and security review are owned by separate agents — see
`agents/README.md`#handoff-chain.
