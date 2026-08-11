# `@devdigest/mcp` — local-only MCP server (stdio) + pre-push review CLI

Exposes DevDigest's existing review capabilities to an MCP client (Claude
Code, Claude Desktop, or any other MCP-speaking client) as five callable
Tools. It is a thin, token-frugal façade over the already-running local
Fastify API — no new data model, no new review logic, no reimplementation of
the Conventions Extractor. See
[`docs/plans/mcp-server.md`](../docs/plans/mcp-server.md) for the full design
and [`docs/plans/l04-blast-radius-and-prepush-cli.md`](../docs/plans/l04-blast-radius-and-prepush-cli.md)
for `get_blast_radius`'s real implementation.

This package also ships a **separate** pre-push CLI (`devdigest review`) —
see [Pre-push review CLI](#pre-push-review-cli) below. It reuses the same
review engine but needs neither the API server nor Postgres.

## Prerequisites

The DevDigest stack (Postgres + the API) must already be running — this
server only ever *calls* `:3001`, it never starts it:

```sh
./scripts/dev.sh
# or, from the repo root:
cd server && pnpm dev
```

## Tools

| Tool | Description |
|---|---|
| `list_agents` | List the reviewer agents configured in this DevDigest workspace. Returns each agent's id, name, description, and model — the id is required by `run_agent_on_pr` and `get_findings`. |
| `run_agent_on_pr` | Run a code review on a pull request using the given agent, wait for it to finish, and return the verdict with findings. Args: `repo` (owner/name), `pr` (PR number), `agent` (id from `list_agents`). |
| `get_findings` | Get the verdict and findings from the most recent completed review of a pull request. Use after `run_agent_on_pr`, or to check a review someone else already ran. |
| `get_conventions` | Get this repository's extracted coding conventions — the same house rules used to ground agent reviews. |
| `get_blast_radius` | Get the impact map of a pull request's changes: which symbols the changed files declare, who calls them, and which HTTP endpoints/crons might be affected. Args: `repo` (owner/name), `pr` (PR number). Data always comes from the `repo-intel` index, never a model. |

All five inputs are flat scalars (`repo`, `pr`, `agent` — no nested objects),
so a model never has to construct nested arguments. Every error response
names a concrete next tool call or command (e.g. "Agent not found. Call
list_agents to get valid agent ids.") — see `src/errors.ts`.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `DEVDIGEST_API_BASE` | `http://localhost:3001` | Base URL of the local API. |
| `DEVDIGEST_MCP_RUN_TIMEOUT_MS` | `180000` (3 min) | Max time `run_agent_on_pr` polls before giving up (poll interval is fixed at 2s). |

## Wiring it into Claude Code

There is no project-scoped `.mcp.json` — the server does not auto-start when
you open this repo in Claude Code. Register it on demand, from the repo root,
when you actually want the tools available:

```sh
./scripts/mcp-on.sh
```

This runs `claude mcp add --scope local devdigest -- npx tsx mcp/src/index.ts`
(`--scope local` keeps the registration private to you, stored in
`~/.claude.json`, not checked into git). It persists across sessions until
you remove it:

```sh
./scripts/mcp-off.sh
```

`claude mcp list` shows what's currently registered.

`run_agent_on_pr` can legitimately run for minutes; it sends MCP progress
notifications on every poll tick to reset the client's own per-call timeout,
but if your client still times out, raise its timeout env vars (Claude Code:
`MCP_TIMEOUT` / `MCP_TOOL_TIMEOUT`).

## stdout is the protocol channel

This is a stdio MCP server: **stdout carries the JSON-RPC protocol**, nothing
else. Every diagnostic goes to stderr (`console.error`) — never
`console.log`. A single stray stdout write corrupts the next frame the client
tries to parse. This rule is scoped to `src/index.ts`/`src/server.ts`/
`src/tools/**`; the CLI below is a different entrypoint and is not bound by
it.

## Pre-push review CLI

`devdigest review --mode working` runs the exact same reviewer
(`reviewPullRequest` from `@devdigest/reviewer-core`, the same engine the web
UI and the CI runner use — no second implementation) against your local git
working tree, before you push. **No API server and no Postgres required** —
it reads `git diff HEAD` directly and calls the LLM provider itself.

```sh
# after a local `npm link` in this package:
devdigest review --mode working

# or, without linking:
cd mcp && npm run review
# or
npx tsx mcp/src/cli.ts review --mode working
```

**Modes:**

| Mode | Status | Covers |
|---|---|---|
| `working` | implemented (default) | `git diff HEAD` — staged + unstaged changes to **tracked** files |
| `staged` | not implemented yet | reserved — registered in `--help`, fails with a clear "not implemented" message |
| `branch` | not implemented yet | reserved — same as above |

**Untracked files are excluded** (`git diff HEAD` doesn't see them). If any
exist, the run prints a warning to stderr naming them — the gap is never
silent.

**Exit codes** (the CI contract):

| Code | Meaning |
|---|---|
| `0` | review ran, no blocking findings |
| `1` | review ran, ≥1 blocking finding (severity ≥ the agent's `ci_fail_on`) |
| `2` | could not run — not a git repo, no diff, missing API key, LLM/network failure, or an unimplemented mode |

**Agent config:** a default review agent ships with the CLI; override it with
`--agent-file <path.json>`, validated against the `AgentManifest` schema
(JSON, not YAML). **API key:** read from `~/.devdigest/secrets.json`
(`OPENROUTER_API_KEY`, stored value wins) or the `OPENROUTER_API_KEY`
environment variable — never printed or logged. `--json` prints a
machine-readable result instead of the human-readable report. `--help` prints
the full contract above verbatim.

## Testing

```sh
cd mcp && npm run typecheck
cd mcp && npm test
```

Hermetic unit tests (vitest). The 5 MCP tools stub `fetch` via an injectable
`ApiClient` (no real network, no API, no DB, no Docker), mirroring the client
suite's philosophy in [`../TESTING.md`](../TESTING.md); one test round-trips a
real `McpServer` over an in-memory MCP transport to prove `list_tools` returns
exactly the 5 tools above. The CLI's tests (`cli-*.test.ts`) stub git and the
`LLMProvider` the same way — no real repo, no network, no server, no DB.
