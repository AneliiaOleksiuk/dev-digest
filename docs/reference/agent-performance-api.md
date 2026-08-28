# Agent Performance API & contracts

Stable lookup for the shipped `GET /agents/:id/stats` and
`GET /agents/performance` HTTP surface and Zod shapes. For behaviour and
design, see [`docs/features/agent-performance.md`](../features/agent-performance.md).

## Disambiguation: `GET /agents/stats` vs `GET /agents/:id/stats`

**These are two different, unrelated endpoints.** This has already caused
one shipped bug in this codebase (`client/INSIGHTS.md`'s 2026-08-23 entry,
"`GET /agents/stats` field-name mismatch") — a hook imported the wrong
contract for the wrong endpoint, and because `lib/api.ts` casts responses
with `as T` and does zero runtime validation, every field silently read
`undefined` instead of throwing.

| Endpoint | Shape | Scope | Built by |
|---|---|---|---|
| `GET /agents/stats` (no `:id`) | `AgentCostEstimate` (server-local, not vendored) | Every workspace agent, scoped to each agent's **current** model only | L07/SPEC-04 — powers the multi-agent-run picker's pre-run cost estimate. **Unchanged by this feature.** |
| `GET /agents/:id/stats` | `AgentStats` (vendored contract) | One agent, range-scoped, model-history-aware | This feature (SPEC-06) |
| `GET /agents/performance` | `AgentPerf` (vendored contract) | Every workspace agent, range-scoped | This feature (SPEC-06) |

If you're adding a fourth agent-stats-shaped hook or handler, trace its
response type to the exact server handler that produces it before trusting
it — three similarly-named shapes (`AgentCostEstimate`/`AgentStats`/
`AgentPerfRow`) are live at once specifically because of this history.

## HTTP

Routes live in `server/src/modules/agents/routes.ts`. Every handler resolves
tenancy via `getContext(app.container, req)` before any work; an agent id
outside the caller's workspace 404s (never a partial leak of its cost data —
this is a tenant-isolation requirement, not incidental behaviour).

| Method | Path | Behaviour |
|---|---|---|
| `GET` | `/agents/:id/stats` | `AgentStats` for one agent, range-scoped. Agent in another workspace → 404. |
| `GET` | `/agents/performance` | `AgentPerf` for every workspace agent, range-scoped. One row per agent, including agents with zero runs in range. Not a routing conflict with `/agents/:id` — Fastify's radix router prefers the static segment regardless of registration order. |
| `GET` | `/agents/stats` | reuse, **unchanged** — see [Disambiguation](#disambiguation-get-agentsstats-vs-get-agentsidstats) above. |

### Querystring — `RangeQuery` (both new endpoints)

Declared once in `routes.ts` (`RangeQuery`, a zod schema with `superRefine`)
and shared by both routes so `?range=` resolves identically on each — the
prerequisite for the two surfaces' numbers to be comparable at all.

| Param | Type | Notes |
|---|---|---|
| `range` | `'1d' \| '30d' \| 'custom'`, optional | Defaults to `30d` when absent. |
| `start` | `string` (ISO date), required with `range=custom` | |
| `end` | `string` (ISO date), required with `range=custom` | |

**Validation (422 before either handler runs, via zod `superRefine` →
`validateRangeQuery` in `modules/agents/helpers.ts`):**

- `range=custom` with a missing `start` or `end` → 422.
- Either date unparseable → 422.
- `start > end` → 422.
- Span exceeds **366 days** (inclusive, UTC-midnight-to-UTC-midnight) → 422.
  A DoS bound on the query planner, not a product limit on how far back
  history goes.

**Resolution semantics (`resolveRange`, same file):**

- Bounds resolve to a **half-open `[start, end)` interval in UTC** — `end`
  is exclusive, so adjacent ranges never double-count a run whose `ran_at`
  lands exactly on a boundary.
- `range=1d` / `range=30d` / absent all resolve relative to the UTC midnight
  *after* "now", so "today so far" is always included regardless of what
  time of day the request lands.
- `range=custom`: `start` resolves to that date's UTC midnight; `end`
  resolves to the UTC midnight **after** the given end date (the given end
  date is fully inclusive).
- The range filters `agent_runs.ran_at` — the run's start timestamp, the
  only time column the table has. It does **not** filter finding decisions:
  a finding produced by an in-range run counts at its *current* decision
  state even if that decision was recorded after the range ended.

**Client-side note (defense-in-depth gap, not reachable via the shipped
UI):** `client/src/lib/hooks/range.ts`'s `validateCustomRange` mirrors the
server's `start <= end` / 366-day checks, but treats an unparseable date
string as *valid* (returns `null`) where the server correctly rejects it.
The only way to reach this client function is via `RangeSelector`'s native
`<input type="date">`, which cannot itself produce an unparseable string, so
this is not reachable from the shipped UI — and the server's own validation
still catches a malformed date regardless. Noted as a Nit from
`plan-verifier`'s Phase 2 review, not a functional gap.

## `AgentStats` (`GET /agents/:id/stats`)

Source: `vendor/shared/contracts/observability.ts`. Adopted **unchanged**
from its pre-existing header-declared shape — this feature only registers
the route that serves it.

| Field | Type | Notes |
|---|---|---|
| `agent_id` / `agent_name` | `string` | |
| `runs` | `int` | Count of the counted run set (see feature doc's shared-aggregation section). |
| `findings_total` / `accepted` / `dismissed` / `pending` | `int` | `pending` = neither accepted nor dismissed yet. |
| `accept_rate` / `dismiss_rate` | `number \| null` | `accepted / (accepted + dismissed)` and its complement; **null**, never `0`, when nothing is decided yet. |
| `avg_findings_per_run` | `number \| null` | |
| `total_cost_usd` / `avg_cost_usd` | `number \| null` | Estimate, never billed — see feature doc. `null`, never `0`, when every counted run has a NULL `cost_usd`. |
| `avg_latency_ms` | `number \| null` | |
| `findings_by_severity` | `{CRITICAL, WARNING, SUGGESTION}` (ints) | Derived from the `findings ⋈ reviews` join — never `agent_runs`' CI-ingest-only severity columns, which are NULL for every local run. |
| `trend` | `StatPoint[]` (`{label, value}`) | Findings-per-run, bucketed across the range. |

## `AgentPerf` (`GET /agents/performance`)

Source: `vendor/shared/contracts/productionize.ts`. `summary.total_cost_partial`,
`summary.most_active_agent_id` and `summary.runs_trend` are additive
extensions this feature made to the pre-existing contract, hand-mirrored
into both `server/src/vendor/shared/contracts/productionize.ts` and
`client/src/vendor/shared/contracts/productionize.ts` (no sync script
exists for that mirror — see root `AGENTS.md`).

### `AgentPerf.summary`

| Field | Type | Notes |
|---|---|---|
| `runs` | `int` | Count of the counted run set, across every workspace agent. |
| `total_cost_usd` | `number \| null` | Total **attributable** spend — excludes orphaned (deleted-agent) and non-`done` runs; `null`, never `0`, when nothing has cost data. |
| `avg_accept_rate` | `number \| null` | The **pooled** rate (total accepted / total decided across all counted agents), not the unweighted mean of per-agent rates, despite the `avg_` name. |
| `most_active_agent` | `string \| null` | Display name of the highest-run-count agent (ties broken by most recent `ran_at`). |
| `most_active_agent_id` | `string \| null` | **New.** Resolves the tile by id — `agents.name` has no unique constraint, so resolving by name alone is unsafe. |
| `total_cost_partial` | `boolean` (default `false`) | **New.** `true` when any counted run has a NULL `cost_usd` — `total_cost_usd` is an under-count, not a fabricated complete sum. Mirrors `MultiAgentRun.total_cost_partial`. |
| `runs_trend` | `number[]` (default `[]`) | **New**, added in the fix-loop beyond the plan's original two summary fields. Workspace-wide run-count-per-bucket series for the Total Runs tile's sparkline — distinct from any per-agent `AgentPerfRow.trend` (findings-per-run), never re-derived from it. |

### `AgentPerfRow` (one per workspace agent, `agents[]`)

| Field | Type | Notes |
|---|---|---|
| `agent_id` / `agent_name` / `provider` / `model` | `string \| null` | |
| `runs` / `findings_total` / `accepted` / `dismissed` | `int` | An agent with zero runs in range still gets a row: all zero/null. |
| `accept_rate` / `dismiss_rate` | `number \| null` | Same null-not-zero rule as `AgentStats`. |
| `avg_findings_per_run` / `total_cost_usd` / `avg_cost_usd` / `avg_latency_ms` | `number \| null` | |
| `last_run_at` | `string \| null` (ISO) | |
| `findings_by_severity` | `{CRITICAL, WARNING, SUGGESTION}` | |
| `trend` | `number[]` | Findings-per-run, bucketed — the array-shaped variant `Sparkline`/`MetricCard` accept, as opposed to `AgentStats.trend`'s `StatPoint[]`. Same underlying bucketing, different projection for a different chart prop. |

### `PerfCostSegment` (`cost_by_agent[]` / `cost_by_model[]`)

`{label: string, value: number}` — deliberately **no `color` field**.
`Donut`'s `DonutSegment` prop requires one; assigning it is a client-side
presentation concern (`AgentPerformanceView/helpers.ts`'s `withDonutColors`),
not something the server computes. Each array sums to `summary.total_cost_usd`.

## Ranking / low-confidence grouping (client-side, not a server field)

`AgentPerfRow` already carries `accepted`/`dismissed`, so "fewer than 5
decided findings" is a pure client-side comparator
(`AgentPerformanceView/helpers.ts`'s `rankByAcceptRate`,
`LOW_CONFIDENCE_THRESHOLD = 5`) rather than a server-computed flag — no
contract field was added for it. See the feature doc's
[Accept-rate ranking](../features/agent-performance.md#accept-rate-ranking-the-low-confidence-group)
section for the UI treatment.

## No model calls

Both endpoints are pure reads over `agent_runs`/`findings`/`reviews` — they
never invoke an LLM, embedder, or provider adapter, on initial load, a range
change, or a table sort.
