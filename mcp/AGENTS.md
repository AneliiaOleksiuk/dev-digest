# mcp — `@devdigest/mcp`

Two things live in this package:

1. A local-only MCP server (stdio) exposing DevDigest's existing review
   capabilities to an MCP client (Claude Code / Claude Desktop) as five Tools:
   `list_agents`, `run_agent_on_pr`, `get_findings`, `get_conventions`,
   `get_blast_radius`. A thin façade over the already-running Fastify API on
   `:3001` — no new data model, no in-process server import.
2. A pre-push review CLI (`devdigest review --mode working`, entrypoint
   `src/cli.ts`) that runs the SAME reviewer (`reviewPullRequest` from
   `@devdigest/reviewer-core`) against the local git working tree, with no API
   server and no database required. It is a **separate, additive entry
   point** — not reachable over the MCP stdio protocol, not bound by the MCP
   tools' HTTP-only rule below. See Non-default conventions.

See [README.md](README.md) for the tool list, the CLI usage, and setup.

**Before starting work:** read [INSIGHTS.md](INSIGHTS.md) — treat its
entries as high-confidence guidance unless this file says otherwise.

**Stack:** `@modelcontextprotocol/sdk` 1.30, zod 3.24 (see Gotchas — the
installed peer resolves to 3.25.x), typescript 5.7, tsx 4.19, vitest 2.1;
the CLI additionally pulls in `@devdigest/reviewer-core` (in-process — see
Non-default conventions) and reads `~/.devdigest/secrets.json`.

**Commands:** `typecheck` (`tsc --noEmit`) · `test` (`vitest run`) · `dev` /
`start` (`tsx src/index.ts`, stdio server) · `review` (`tsx src/cli.ts review
--mode working`, the pre-push CLI) · `bin/devdigest.js` (a committed shim that
re-execs the CLI via `tsx`, wired as this package's `bin`, so a local `npm
link` gets you the literal `devdigest review --mode working`).

## Map

- `src/index.ts` — the ONLY file touching stdio: builds the MCP server,
  connects `StdioServerTransport`.
- `src/server.ts` — `createMcpServer()`: constructs `McpServer` and registers
  all five tools. Pure wiring, no transport.
- `src/api-client.ts` — the ONLY module the 5 MCP tools use to call the
  network. Thin `fetch` wrapper over the local API; injectable `fetchImpl` for
  tests.
- `src/schemas.ts` — flat input schemas + compact output schemas (zod) for
  all five tools, plus the local re-declarations of the small set of enums
  this package needs (`Severity`, `Verdict`, `ConventionStatus`) — see
  Non-default conventions.
- `src/project.ts` — pure mapping functions from the upstream
  `@devdigest/shared` record shapes to this package's compact DTOs.
- `src/resolve.ts` — the shared `repo` → `pr` → `agent` resolution chain used
  by `run_agent_on_pr`, `get_findings`, and `get_blast_radius`. Never throws —
  returns a `Resolved<T>` discriminated union so callers just `return` the
  failure.
- `src/errors.ts` — `toolError()` / `apiFailureToolError()`, the only way any
  tool reports failure (a normal `CallToolResult` with `isError: true`).
- `src/tools/*.ts` — one file per tool: `list-agents.ts`, `run-agent-on-pr.ts`,
  `get-findings.ts`, `get-conventions.ts`, `get-blast-radius.ts`.
- `src/cli.ts` + `src/cli/*.ts` (`repo.ts`, `modes.ts`, `agent.ts`, `llm.ts`,
  `report.ts`) — the pre-push CLI. A separate entrypoint from `src/index.ts`;
  not part of the MCP tool surface above.
- `bin/devdigest.js` — the `bin` shim (plain JS, no build step) that re-execs
  `tsx src/cli.ts`.

## Non-default conventions

- **The 5 MCP tools are HTTP-only, never in-process** — this rule is
  unchanged and does not extend to the CLI (next bullet). `src/tools/**`,
  `src/server.ts`, and `src/index.ts` never import from `server/src` or
  `@devdigest/reviewer-core` at runtime — only `import type … from
  '@devdigest/shared'` (erased at compile time). Importing
  `server/src/modules/**` directly would fight `reapStaleRuns()`'s
  single-API-process assumption and can't observe the live server's
  in-memory `runBus`. See `docs/plans/mcp-server.md` WI2.
- **The pre-push CLI (`src/cli.ts` + `src/cli/*`) is a documented, deliberate
  exception to the rule above — not a precedent for the 5 tools.** It imports
  `@devdigest/reviewer-core` in-process (via the `@devdigest/reviewer-core`
  path alias in `tsconfig.json`, used **only** under `src/cli*`), reads
  `~/.devdigest/secrets.json` directly, and makes real LLM calls — because it
  is a one-shot process that must work with no API server and no database
  running, and it never imports `server/src`. The MCP tools' posture (no
  secrets, no LLM, no `server/src`) is otherwise unchanged. See
  `docs/plans/l04-blast-radius-and-prepush-cli.md` WI10 for the full
  rationale and the runtime probes that confirmed this works under `tsx`.
- **The handful of enums this package needs (`Severity`, `Verdict`,
  `ConventionStatus`) are redeclared locally in `schemas.ts`**, not imported
  as values from `@devdigest/shared` — every import from that package here is
  `import type`. Keep these three enums in sync by hand if the upstream
  contracts change (same manual-mirror discipline the repo already applies
  to `@devdigest/shared` itself).
- **Tools, not Resources — settled, not an open question.** All five reads
  are MCP Tools so the "agent not found → call list_agents" error-recovery
  contract stays available (Resources have no equivalent affordance).
- **npm, not pnpm** — matches `reviewer-core/` and `e2e/`, the repo's other
  leaf/tooling packages (see root `AGENTS.md`'s "not a monorepo" rule).

## Gotchas

- **stdout is the protocol channel — scoped to the stdio server, not the
  CLI.** Nothing under `src/index.ts`/`src/server.ts`/`src/tools/**` may write
  to stdout — no `console.log`, no stray `process.stdout.write`; diagnostics
  go to stderr (`console.error`). A single accidental stdout write there
  corrupts every subsequent JSON-RPC frame. `src/cli.ts` is a *different*
  entrypoint and legitimately writes its human-readable report to stdout
  (warnings/diagnostics still go to stderr) — don't "fix" the CLI's output
  into stderr on the mistaken assumption this rule is package-wide.
- **`@modelcontextprotocol/sdk`'s peer range is `zod: "^3.25 || ^4.0"`.**
  `package.json` here still pins `"zod": "^3.24.1"` to match the rest of the
  repo; npm resolves that to `zod@3.25.x` (satisfies both ranges), so there
  is exactly one zod module instance and no zod-4 schemas anywhere in this
  package. Don't "fix" the declared range down to a version below 3.25 — it
  would violate the SDK's peer dependency.
- **`registerTool`'s `inputSchema`/`outputSchema` take a raw zod SHAPE**
  (`{key: ZodType, ...}`), not a `z.object(...)` instance. `schemas.ts`
  exports both — the `*Shape` object for `registerTool`, and
  `z.object(*Shape)` for `.parse()`-validating a handler's own output before
  returning it.
- **`structuredContent` must be a JSON object, not a bare array.** Even
  though the plan's Outputs table describes `list_agents`/`get_conventions`
  as returning `X[]`, the MCP `CallToolResult.structuredContent` field is
  typed as a record — both tools wrap their array under one top-level key
  (`{agents: [...]}`, `{conventions: [...], note?}`).
- `run_agent_on_pr`'s poll loop is real-timer based (`setTimeout`) so it
  interoperates with Vitest fake timers in tests (`vi.useFakeTimers()` +
  `vi.advanceTimersByTimeAsync()`).

## Do-not-touch

None — no vendored or generated directories in this package. (It does *read*
`server/src/vendor/shared/**` via a tsconfig path alias, type-only — that
directory is the **server's** do-not-touch, not this package's to edit.)

## Docs

- [README.md](README.md) — the 5 tools, the CLI usage, env vars,
  prerequisites, `.mcp.json` setup.
- [../docs/plans/mcp-server.md](../docs/plans/mcp-server.md) — the approved
  Development Plan the MCP tool surface was built from (work items, schemas,
  error table, risks).
- [../docs/plans/l04-blast-radius-and-prepush-cli.md](../docs/plans/l04-blast-radius-and-prepush-cli.md)
  — the approved Development Plan `get_blast_radius`'s real implementation
  and the pre-push CLI were built from.
- [../TESTING.md](../TESTING.md) — where this suite fits overall.
- [INSIGHTS.md](INSIGHTS.md) — the "why" behind the decisions above.

**Before ending a session:** update INSIGHTS.md with anything non-obvious
you learned — don't skip this step (`engineering-insights` skill).
