# INSIGHTS — mcp

Accumulated engineering knowledge for this package: what worked, what didn't,
codebase-specific patterns, tool quirks, and open questions — kept OUT of
[AGENTS.md](AGENTS.md) under the ≤100-line / map-not-documentation rule.

Read at the start of every session per AGENTS.md, and updated at the end via
the `engineering-insights` skill — treat entries here as high-confidence
guidance unless AGENTS.md says otherwise. Append-only; entries must pass the
"cold read" test (actionable without re-investigation) — see
[../.claude/skills/engineering-insights/SKILL.md](../.claude/skills/engineering-insights/SKILL.md).

## What Works

- **Round-trip testing over `InMemoryTransport.createLinkedPair()` +
  `Client` from `@modelcontextprotocol/sdk`** (see `test/server.test.ts`) is
  the only way to actually prove `list_tools` returns what `registerTool`
  calls produced — asserting against handler functions directly can't catch
  a tool that was registered wrong (bad name, missing annotation) or not
  registered at all. Build a `McpServer` via `createMcpServer()`, connect
  both ends of the pair, then `client.listTools()` / `client.callTool()`.
  No real process, no stdio, runs in the normal vitest process.
- **Injecting `fetch` into `createApiClient(baseUrl, fetchImpl)`** instead of
  `vi.stubGlobal('fetch', ...)` kept every test hermetic without any global
  state to reset between tests — same DI-over-module-mocking preference
  `server/AGENTS.md` already documents for its own adapters.
- **Verifying `import type` erasure by literally spawning `npm run dev` and
  speaking JSON-RPC to it over stdio** (send a raw `initialize` + `tools/list`
  request via a piped child process, read stdout) is still the right
  technique to prove a change is safe at runtime, not just at typecheck. **The
  failure mode this was originally written to predict was wrong, though** —
  corrected here (L04 pre-push CLI session, 2026-08-09): a stray *value*
  import from `@devdigest/shared` does NOT crash at spawn with
  `ERR_MODULE_NOT_FOUND`. `tsx` resolves `tsconfig.json`'s `paths` at
  runtime — confirmed twice: once by a probe file doing
  `import { Review } from '@devdigest/shared'` under `tsx`, and again for
  real when `mcp/src/cli/agent.ts` imports the `AgentManifest` zod schema
  (a genuine value, not just a type) from `@devdigest/shared` and it works
  cleanly both at `npm run typecheck` and at real invocation
  (`npm run review`). This is exactly how `server/`
  (`tsx watch src/server.ts`) has always imported the same vendored
  contracts as values — no different for `mcp/`. The **stdio-spawn
  verification technique** is still worth doing after any
  `@devdigest/shared`-touching change (it does catch real things — bad
  JSON-RPC framing, accidental stdout writes); just don't expect
  `ERR_MODULE_NOT_FOUND` to be the failure mode it'll ever actually catch.
  **A tool-format gotcha noticed while re-verifying this**: the MCP stdio
  protocol frames each JSON-RPC message with a trailing `\n`
  (newline-delimited JSON), NOT `Content-Length:` headers the way LSP does —
  a probe script written assuming LSP-style framing gets zero bytes back
  from the server with no error, easy to misdiagnose as "the server didn't
  respond." See `@modelcontextprotocol/sdk/dist/esm/shared/stdio.js`'s
  `ReadBuffer`/`serializeMessage` for the actual wire format.

## What Doesn't Work

- **Reusing `@devdigest/shared`'s zod enums (`Verdict`, `Severity`,
  `ConventionStatus`) as runtime values** would reintroduce exactly the
  cross-module-instance zod risk `server/AGENTS.md` already warns about
  ("vendored zod and the api's own zod can be different module instances").
  Since every `@devdigest/shared` import here is `import type` only (see
  Codebase Patterns), those enums had to be **redeclared** as plain
  `z.enum([...])` calls in `schemas.ts` instead of imported. Fine for three
  small, stable enums; would not scale to re-declaring the whole contract
  surface.
- **Narrowed this session (L04 CLI, 2026-08-09): the real risk is *composing*
  a vendored zod schema with a LOCALLY-built one, not calling `.parse()`/
  `.safeParse()` on a vendored schema standalone.** `mcp/src/cli/agent.ts`
  imports the real `AgentManifest` zod object (a value, not just its type)
  from `@devdigest/shared` and calls `AgentManifest.safeParse(json)`
  directly on it — no `z.object({...AgentManifest.shape, extra: ...})`,
  no merging with a schema built from this package's own `zod` import. That
  works cleanly (see Tool & Library Notes below for why: Node resolves the
  bare `zod` specifier inside the vendored file itself, not from the
  importer, so every consumer of a given vendored schema gets the SAME
  physical zod instance — `server/node_modules/zod` — regardless of which
  package's tsconfig aliased it in). The three redeclared enums above are
  about a different, narrower goal (keeping this package's OWN schemas,
  e.g. `GetFindingsOutput`, buildable without depending on the vendor
  file's zod instance at all) — not a sign that parsing a vendored schema
  directly is unsafe.

## Codebase Patterns

- **`registerTool(name, config, cb)`'s `inputSchema`/`outputSchema` want a
  raw zod SHAPE** — a plain object `{key: ZodType, ...}` (the SDK's
  `ZodRawShapeCompat`) — **not** a `z.object(...)` instance, even though a
  full `AnySchema` is also technically accepted per the type signature.
  `schemas.ts` exports both per DTO: the `*Shape` object (for
  `registerTool`) and `z.object(*Shape)` (for a handler's own
  `.parse()`-before-return self-check). Keep them derived from the same
  object literal so they can't drift.
- **`CallToolResult.structuredContent` is typed as a JSON object/record, not
  an array** (`z.record(z.string(), z.unknown())` in the SDK's own
  `CallToolResultSchema`). `docs/plans/mcp-server.md`'s WI3 describes
  `list_agents`/`get_conventions` outputs as bare `AgentSummary[]` /
  `ConventionSummary[]`, but that can't be handed to `structuredContent`
  directly — both tools wrap the array under one top-level key
  (`{agents: [...]}`, `{conventions: [...], note?}`) instead. `get_findings`
  /`run_agent_on_pr`'s `VerdictResult` was already object-shaped, so no
  wrapping was needed there.
- **The pre-push CLI (`src/cli.ts` + `src/cli/*`, WI10–WI14) is a scoped,
  documented exception to two of this package's rules — never expand either
  exception beyond `cli*` files.** (1) It's the only place that imports
  `@devdigest/reviewer-core` in-process (everywhere else, incl.
  `src/tools/**`/`src/server.ts`/`src/index.ts`, stays HTTP-only — verified
  via `grep -r "reviewer-core\|server/src" src/tools src/server.ts
  src/index.ts` returning nothing). (2) It's the only place that imports a
  `@devdigest/shared` VALUE, not just a type (`AgentManifest`, for
  `.safeParse()`-validating `--agent-file`) — everywhere else stays
  `import type` only. Both exceptions exist because the CLI is a one-shot
  process that never runs alongside the stdio server and never touches
  `server/src` — see `mcp/AGENTS.md`'s CLI paragraph.
- **Long-running-tool progress**: `run_agent_on_pr`'s poll loop calls
  `extra.sendNotification({method:'notifications/progress', params:{...}})`
  on every tick, gated on `extra._meta?.progressToken` being present (a
  client that didn't ask for progress gets none — per spec, this is
  optional). This is what resets the MCP client's own per-call timeout
  during a multi-minute run.

## Tool & Library Notes

- **`@modelcontextprotocol/sdk@1.30.0`'s peer dependency is
  `zod: "^3.25 || ^4.0"`**, not `^3.24`. This package's `package.json` still
  declares `"zod": "^3.24.1"` (matching `server/`/`reviewer-core/`'s pin) —
  npm's resolver picks the highest version satisfying *every* constraint in
  the tree, which lands on `zod@3.25.x`. Verified via `npm ls zod`: exactly
  one zod instance, still zod 3, no zod-4 schemas anywhere. The plan's risk
  item 4 (confine zod 4 to MCP tool schemas if the SDK forces it) turned out
  to be **moot** — don't preemptively split the zod version for this SDK
  version; only revisit if a future SDK major actually requires zod 4 as the
  *floor* (e.g. `zod: "^4.0"` with no 3.x branch).
- **`@modelcontextprotocol/sdk`'s subpath exports** (`server/mcp.js`,
  `server/stdio.js`, `client/index.js`, `inMemory.js`, `types.js`,
  `shared/protocol.js`) are real files under `dist/esm/`, reachable via the
  package's `"./*"` wildcard export map entry — no need to import everything
  through the top-level `.`/`./server` barrels, and importing the specific
  subpath keeps `tsx`'s per-file transform cheap.
- `npm install` in this package reports a handful of moderate/high/critical
  `npm audit` findings, all inside the `vitest@2.1.x` → `vite` → `esbuild`
  dev-server chain (`GHSA-67mh-4wv8-2f99`) — the same class of dev-only
  finding `reviewer-core`'s own `npm audit` already shows for its pinned
  `vitest@2.1.8`. Not a runtime/production surface (this package never emits
  JS or runs a bundler dev server); don't bump `vitest` off the repo's
  pinned `^2.1.8` line to chase this without checking with the other
  packages first — they'd drift out of lockstep for no shared benefit.
- **Adding the `@devdigest/reviewer-core` tsconfig path alias (WI10, for the
  CLI only) is not enough on its own for tests — `vitest.config.ts` needs
  the matching `resolve.alias` too**, the same way `@devdigest/shared`
  already has one. `tsc`/`tsx` read `tsconfig.json`'s `paths`; Vite/Vitest
  reads its own config, not tsconfig, for module resolution during tests.
  Missing this produces `Failed to load url @devdigest/reviewer-core ...
  Does the file exist?` the moment any test imports `src/cli.ts` (or
  anything under `src/cli/`), even though `npm run typecheck` is clean.
  Mirrors `server/vitest.config.ts`'s alias for the same package.
- **`util.parseArgs` (Node builtin, no dependency) is enough for a small CLI
  with `--flag value` / `--flag` boolean options + one positional
  subcommand** (`devdigest review --mode working`) — no need to reach for
  `commander`/`yargs` for a 4-flag surface. `allowPositionals: true` +
  reading `positionals[0]` as the subcommand is the whole pattern.

## Recurring Errors & Fixes

- **`mcp` CI typecheck fails with `Cannot find module 'zod'` from
  `server/src/vendor/shared/**` (and cascading `any` in `project.ts` /
  `report.ts`).** Path-mapped `@devdigest/shared` files resolve bare
  `zod` by walking up from `server/…`, not from `mcp/node_modules`. Mirror
  `reviewer-core/tsconfig.json`: add `"zod"` / `"zod/*"` paths pointing at
  `./node_modules/zod`. Without this, installing reviewer-core deps alone is
  not enough.
- **`mcp` CI typecheck exits 134 (JS heap OOM).** Two stacked causes:
  (1) MCP SDK 1.30 `registerTool` generics + zod 3.25 shapes explode tsc
  (TS2589 / ~4GB heap) — wrap registrations in `src/tools/register.ts` to
  erase that generic surface. (2) CLI path-maps raw `reviewer-core` source —
  split `tsconfig.json` (tools) / `tsconfig.cli.json` (CLI) and run both
  under `node --max-old-space-size=6144`. `.github/workflows/mcp.yml` also
  sets `NODE_OPTIONS` the same way.

## Session Notes

- 2026-08-08: Built `mcp/` end to end from `docs/plans/mcp-server.md`
  (Work Items 1–7, 9): package skeleton, HTTP-only `ApiClient`, the 5 tool
  schemas + handlers (`list_agents`, `run_agent_on_pr`, `get_findings`,
  `get_conventions`, `get_blast_radius` stub), the shared `toolError`
  convention, the vitest suite (14 tests, fetch stubbed via DI, one real MCP
  round-trip test), and `.github/workflows/mcp.yml`. Verified live via an
  actual `npm run dev` spawn speaking JSON-RPC over stdio (not just
  typecheck) — confirmed clean stdout/stderr separation and that `import
  type` erasure holds under `tsx`. WI8 (root `AGENTS.md`/`README.md`/
  `TESTING.md` package-listing edits) was done by a separate, concurrent
  agent — not touched here to avoid a merge conflict on those shared files.
- 2026-08-09: Built Part 2 of `docs/plans/l04-blast-radius-and-prepush-cli.md`
  (WI10–WI14) — the pre-push CLI. `mcp/tsconfig.json` + `mcp/vitest.config.ts`
  gained the `@devdigest/reviewer-core` alias (CLI-only, see Codebase
  Patterns); `src/cli.ts` (entrypoint, `util.parseArgs`) +
  `src/cli/{repo,modes,agent,llm,report}.ts`; `bin/devdigest.js` shim +
  `package.json`'s `bin`/`review` script + root `scripts/review.sh`; 3 new
  hermetic test files (`test/cli-run.test.ts`, `test/cli-agent.test.ts`,
  `test/cli-llm.test.ts`, 16 tests, fake `GitRunner` + fake `LLMProvider`,
  no real repo/network); `.github/workflows/mcp.yml` gained the
  `reviewer-core/**` path filter + an "Install reviewer-core deps" step.
  Also relocated `parseUnifiedDiff` from `server/src/adapters/git/
  diff-parser.ts` into `reviewer-core/src/diff/parse.ts` (WI11, not a
  `mcp/` file but required first — see `reviewer-core/INSIGHTS.md`).
  Verified live: the real stdio server still starts and returns exactly 5
  tools (newline-delimited JSON-RPC probe, not just `npm run dev` + eyeball);
  `bin/devdigest.js --help`/`review --mode staged` invoked directly (not
  just via `npm run review`) to prove the shim's exec + exit-code
  forwarding; a real `git diff HEAD` on this repo's own dirty working tree
  ran all the way through repo-root detection → diff collection → untracked-
  file warning → diff parsing → agent loading, failing cleanly at the (no
  key available in this environment) LLM-resolution step with exit 2 and no
  stack trace — Postgres/the API server were left running throughout (owned
  by a concurrent agent's session) but the CLI code path has no way to reach
  either (no `api-client` import, no DB import), so their being up doesn't
  weaken this as a "no server/DB required" proof.
- 2026-08-09: Fixed mcp CI typecheck — `zod`/`zod/*` path aliases in
  `mcp/tsconfig.json` (same as reviewer-core); then fixed OOM (exit 134)
  via `registerTool` wrapper + split `tsconfig.cli.json` + 6GB heap.
  `npm run typecheck` + `npm test` (35) green locally.

- 2026-08-11: Mentor review on L04-MCP flagged two gaps: no `config.ts`
  (raw `process.env` reads, no validation/throw) and no root `.mcp.json`.
  Checking `docs/plans/mcp-server.md` WI8 showed the root `.mcp.json` was
  **originally planned** but the implementation session substituted
  `scripts/mcp-on.sh`/`mcp-off.sh` (on-demand, `--scope local`, never
  committed) without a recorded decision — this session restores WI8's
  original intent. Added `src/config.ts` (`getApiBase`/`getRunTimeoutMs`,
  throw `ConfigError` on a set-but-invalid value, read fresh per call — not
  memoized — so existing tests that mutate `process.env` between cases keep
  working unchanged) and a committed root `.mcp.json`. One non-obvious fix
  needed in `run-agent-on-pr.ts`: `errors.ts`'s own docblock says a tool must
  **never** let a thrown error cross the protocol boundary
  ("`isError: true`", not a thrown exception) — so `getRunTimeoutMs()`'s
  throw had to be caught inside `runAgentOnPrHandler` and turned into
  `toolError(...)`, and the read was moved to the very top of the handler
  (before `resolveRepo`/`api.post`) so an invalid timeout config fails
  *before* a review run is started server-side, not after. `getApiBase()`'s
  throw needed no such handling — it fires once at server-construction time
  (`createApiClient()`'s default param, called from `index.ts`'s `main()`),
  so it's already caught by `main()`'s existing `.catch()` → stderr + `exit(1)`.
  `scripts/mcp-on.sh`/`mcp-off.sh` were kept (user decision) as a documented
  manual alternative for user-scope registration outside this project.

## Open Questions

_(to be filled in)_
