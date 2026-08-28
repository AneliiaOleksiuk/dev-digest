# Development Plan: Agent Performance dashboard (+ the per-agent Stats tab it aggregates)

Source spec: [`specs/SPEC-06-agent-performance-dashboard.md`](../../specs/SPEC-06-agent-performance-dashboard.md)
(SPEC-06, status draft, 42 acceptance criteria, 17 edge cases, 13 NFRs,
decisions D-1…D-19). The spec is the authoritative requirements source — this
plan sequences it, it does not restate it. Every `AC-*` / `E-*` / `NFR-*` /
`D-*` reference below points into that file.

### Objective

Close the leftover L07 gap by building the never-registered
`GET /agents/:id/stats` + a `Stats` tab in `AgentEditor`, then build the L08
workspace-wide Agent Performance dashboard (`GET /agents/performance` +
`/agent-performance`) on top of it — both served by **one** shared,
range-parameterized aggregation so a per-agent number on the dashboard is the
same code path as that agent's Stats tab, not a re-derivation (G-3, AC-7/AC-8,
verified by AC-18).

### Scope

- **Packages/modules touched:** `server/` (reviews repository + agents module +
  vendored contracts + possibly one generated migration) and `client/`
  (new hooks, new `AgentEditor` tab, new `/agent-performance` route, nav, i18n).
  `reviewer-core/` and `e2e/` are untouched.
- **Execution mode:** **multi-agent** — the full handoff chain from
  [`agents/README.md`](../../agents/README.md): `implementer` → `test-writer` →
  `plan-verifier` → `doc-writer`, each a separate invocation. `implementer`
  does **not** author new test files; the required coverage is listed under
  *Test plan → Coverage `test-writer` must add* so it is not lost in handoff.
- **PR shape:** **one PR**, with phased commits A → B → C → D → E in that
  order. Rationale: the spec's central correctness check (AC-18, the
  dashboard-vs-Stats-tab field-by-field equality test) is only writable once
  *both* endpoints exist. Splitting into two stacked PRs would merge the first
  one without the single check the whole spec exists to enforce (Problem §3).
  Phased commits give the same reviewable two-unit history without that loss,
  and match the user's original one-PR ask. Commit after each phase per the
  repo's commit-per-stage convention.
- **Explicitly out of scope:** `reviewer-core/`, `run-executor.ts`, the review
  path, finding accept/dismiss semantics, `GET /agents/stats` +
  `AgentCostEstimate` (stays serving the multi-agent picker unchanged — E-2),
  the other two L08 items (weekly digest, plugin export), any new persisted
  aggregate table, any provider-billing integration, and `e2e/`.

### Constraints

**Architecture**

- Server follows onion architecture: `routes → service → port ← adapter`, no
  infrastructure imports in domain code, enforced by
  `pnpm arch:check` (`depcruise --config .dependency-cruiser.cjs src`).
  NFR-11.
- `agent_runs` / `findings` are owned by the **reviews** domain
  (`modules/reviews/repository/run.repo.ts` + the `ReviewRepository` facade at
  `modules/reviews/repository.ts`), **not** the agents module. The agents
  module reaches them only via `container.reviewRepo` — the sanctioned
  cross-cutting DI accessor already used by
  `AgentsService.stats()` (`modules/agents/service.ts:204-209`). Never a raw
  `db`/schema import from `modules/agents/**`.
- Routes declare zod `params`/`querystring` schemas so invalid input 422s
  **before** the handler runs — do not hand-roll `Schema.parse(req.query)`
  inside a handler (`server/AGENTS.md`, Non-default conventions).
- `modules/agents/helpers.ts` is by its own docblock a **pure, no-I/O** file
  (lines 5-9). New shaping logic follows that contract.
- Client: feature logic in a colocated `_components/<Name>/` folder next to the
  page that uses it, each with its own `*.test.tsx`; pages stay thin; data
  access **only** through `src/lib/hooks/*`; UI imported **only** from the
  `@devdigest/ui` barrel, never from `src/vendor/ui/<layer>/*` directly, and
  never `recharts` directly (`client/AGENTS.md`).

**Do-not-touch paths and their sanctioned exceptions**

- `*/src/vendor/**` is hand-mirrored, no sync script (root `AGENTS.md`).
  WI6 and WI13 are deliberate, sanctioned exceptions (contract extension +
  nav entry — the latter is the 6th use of the precedent
  `client/INSIGHTS.md` records for the `multi-agent` entry). Every other
  vendored file stays untouched.
- `*/src/db/migrations/**` is drizzle-kit generated — WI5 regenerates via
  `pnpm db:generate` and applies via `pnpm db:migrate`; never hand-edit a
  migration file, and never assume migrations run on boot (root `AGENTS.md`).

**INSIGHTS entries that bind this work**

- `client/INSIGHTS.md`, 2026-08-23 entry ("`GET /agents/stats` field-name
  mismatch (Fix A, blocking)") — `lib/api.ts` casts with `as T` and does
  **zero** runtime validation, so a wrong-but-plausible response type fails
  silently as `undefined` on every field. Its verbatim lesson: *"a vendored
  contract with the exact right-looking field names for a DIFFERENT endpoint
  of the same resource is a worse trap than a missing type."* This feature
  makes **three** similarly-named shapes live at once (`AgentCostEstimate`,
  `AgentStats`, `AgentPerfRow`) — spec E-1.
- `client/INSIGHTS.md`, 2026-08-22/23 entry — the `nav.ts` do-not-touch
  exception precedent, **and** its own factual error: it says the
  `multi-agent` entry landed in the "WORKSPACE group"; `nav.ts:70-81` actually
  has it in **GLOBAL**. Code is ground truth (E-17). See Risks below.
- `server/INSIGHTS.md`/`modules/agents/service.ts:211-213` — `AgentsService.stats()`
  was already fixed once from an N+1 (`avg()` round trip per agent) to ONE
  batched query. NFR-4: do not reintroduce per-agent round trips.
- Root `INSIGHTS.md`, Tool & Library Notes — `pnpm <script>` can abort with
  `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` in this environment; fall back
  to the extensionless `./node_modules/.bin/<bin>` shim under Git Bash.
- Root `INSIGHTS.md`, Recurring Errors — `git commit` with no pathspec commits
  the **whole** staged index. Phased commits here must be path-scoped.

**Security requirements carried as hard work-item requirements (not afterthoughts)**

- **NFR-1 (A01, tenant isolation)** — both endpoints `workspaceId`-scoped as an
  explicit repository parameter, never inferred, via
  `getContext(app.container, req)` exactly as every existing agents route does
  (`modules/agents/routes.ts:76,81,92`). `GET /agents/:id/stats` for an agent
  in another workspace must **404**, not leak that agent's spend. Textbook IDOR
  surface — the whole payload is business-sensitive cost data.
- **NFR-2 (A05/A08, input validation)** — range params are the only
  attacker-controlled input; validated by a route-level zod schema as real
  dates, with `start <= end` and a max **366-day** span (AC-4, D-11), 422
  otherwise.
- **NFR-3 (A06, query-cost DoS)** — aggregation happens **in SQL** (`GROUP BY`),
  never by loading findings into Node. Bounded by AC-4's max span plus the
  global 120 req/min limit (`app.ts:96`); a per-route
  `config: { rateLimit: … }` override (pattern: `modules/brief/routes.ts:55`,
  `modules/ci/routes.ts:113`) only if WI5's measurement warrants it.
- **NFR-5 (A05)** — agent names and model strings are untrusted display text:
  React JSX escaping only, never `dangerouslySetInnerHTML`, never interpolated
  into a query or path server-side.
- **NFR-7 (A10, fail closed not fail-zero)** — a failed aggregation surfaces as
  an error state, never as a confident `$0.00`. AC-34/AC-35 are a
  misreporting-prevention requirement, not just UX polish.

### Recommendations

Three things the spec does not cover that change the work, plus two judgement
calls. All are surfaced here rather than silently applied.

1. **`useAgentStats` is already taken — the new hook must not reuse the name.**
   `client/src/lib/hooks/multi-agent.ts` already exports `useAgentStats` for
   `GET /agents/stats` (returning the local `AgentCostEstimate` interface), and
   `src/lib/hooks/index.ts` re-exports every hook file with `export *`. A
   second `useAgentStats` for `GET /agents/:id/stats` is a barrel collision
   **and** is E-1's trap in hook-name form. WI8 names it
   `useAgentDetailStats`. If the implementer prefers a different name that is
   fine — reusing `useAgentStats` is not.
2. **AC-31's <5-decided threshold needs no contract field.** `AgentPerfRow`
   already carries `accepted` and `dismissed` (`productionize.ts:146-147`), so
   `decided = accepted + dismissed` is derivable client-side. That keeps the
   ranking rule a pure client comparator — which is exactly what AC-31's own
   *verify* note asks for ("unit test on the sort comparator") — and avoids a
   third vendored-contract edit. WI6 therefore adds only the two fields D-5 and
   D-14 actually require.
3. **`git diff --no-index` cannot be the mirror check for WI6.** The two
   `productionize.ts` copies have already drifted (E-14: the server copy has
   `'openrouter'` in its `provider` enum at line 36, the client copy does not).
   The check is "the edited hunk is byte-identical in both copies", not "the
   files are identical" — and the drift must **not** be fixed as a drive-by.
4. **Do the query-plan measurement (WI5) before writing the dashboard's client
   code, not after.** E-12 is a real structural problem, not a hypothetical:
   the only relevant index is `(workspace_id, source, ran_at)` and `source`
   sits *between* the two columns this query filters on, so with D-16's
   decision to count CI runs alongside local runs (i.e. no `source` predicate)
   a range scan cannot use `ran_at` as an index range. Ordering WI5 inside
   Phase A means an index migration, if needed, lands in the same phase as the
   query that needs it.
5. **Recommended commit boundaries within the single PR:** A (WI1-WI5, server
   aggregation + Stats endpoint + any migration), B (WI6-WI7, contracts +
   dashboard endpoint), C (WI8-WI9, Stats tab), D (WI10-WI13, dashboard page +
   nav + i18n), E (`implementer`'s final self-check fixes, if any). This keeps
   the vendored-contract edit (WI6) isolated in one reviewable commit.

### Work items

#### Phase A — the shared aggregation and the Stats endpoint (server)

**1. Range query schema + pure UTC half-open range resolver.**

- Files/modules: `server/src/modules/agents/routes.ts` (the zod
  `querystring` schema, declared alongside the existing `ProviderParams` /
  `VersionParams` at the top of the file);
  `server/src/modules/agents/helpers.ts` (the pure resolver — this file's
  docblock at lines 5-9 declares it I/O-free, so only the pure date math goes
  here).
- Applicable skills: `zod`, `fastify-best-practices`, `security`,
  `typescript-expert`.
- Details: three modes `1d` / `30d` / custom `[start, end]` (AC-1); default
  `30d` when absent (AC-5); resolve to a **half-open `[start, end)` interval in
  UTC** so adjacent ranges never double-count (AC-3); reject at the route with
  **422** when `start > end` or the span exceeds **366 days** (AC-4, D-11,
  NFR-2). Existing querystring-schema precedents to follow:
  `modules/ci/routes.ts:176`, `modules/eval/routes.ts:155`,
  `modules/project-context/routes.ts:45`.
- Definition of done: a request with `range=1d`, `range=30d`, absent range, and
  a valid custom pair all resolve to the documented `[start, end)` UTC bounds;
  `start > end` and a 367-day span each 422 **before** the handler body runs
  (no `parse()` call inside the handler); `pnpm typecheck` clean.

**2. The single counted-run-set aggregation query (the core of AC-7/AC-8).**

- Files/modules: `server/src/modules/reviews/repository/run.repo.ts` — a new
  exported function beside `avgStatsForAgents` (lines 240-272), which is the
  shape to copy; `server/src/modules/reviews/repository.ts` — the matching
  `ReviewRepository` facade method beside `avgStatsForAgents` (lines 188-199).
- Applicable skills: `drizzle-orm-patterns`, `onion-architecture`, `security`,
  `postgresql-table-design`.
- Details:
  - Parameterized by `(workspaceId, agentIds[], range)` — **one** function
    invoked with a single agent id by `GET /agents/:id/stats` and with the
    workspace's agents by `GET /agents/performance` (AC-7).
  - The **counted run set**, defined exactly once and used by every number on
    both surfaces: `agent_runs` WHERE `workspace_id` = caller's workspace AND
    `ran_at` within the half-open range AND `status = 'done'` AND
    `agent_id IS NOT NULL` (AC-8, AC-9, D-12, D-17). No `source` filter — CI
    runs count alongside local runs (E-7, D-16), matching what
    `avgStatsForAgents` already does.
  - Range filters `agent_runs.ranAt` (`db/schema/runs.ts:32`) — the only time
    column the table has (AC-2, D-4).
  - Finding rollup by joining `findings` → `reviews` on `findings.reviewId`,
    selecting on `reviews.runId` within the counted run set and
    `reviews.kind = 'review'` — the exact join already at
    `run.repo.ts:63-67`. The `kind` filter is what stops `kind:'summary'` rows
    inflating counts (E-16). `reviews.runId` has no FK (E-15), so a stale
    `run_id` simply drops out.
  - **Never** read `agent_runs.critical/.warning/.suggestion` for severity —
    those are written only by CI ingest
    (`modules/ci/repository.drizzle.ts:145-148`) and are NULL for every local
    run (AC-11, D-6).
  - Also return: per-`(agent_id, model)` cost split using each run's **own**
    `agent_runs.model` snapshot, not the agent's current `agents.model`
    (AC-22, D-7); `last_run_at` per agent (AC-29); a per-agent
    findings-per-run bucketed series rich enough for **both** trend
    projections (E-3 — one series, two projections, never two trend
    computations); and enough raw counters for the caller to detect a NULL
    `cost_usd` in the counted set (AC-27/E-9 — never coerce NULL to 0).
  - **NFR-3/NFR-4:** every aggregate computed in SQL via `GROUP BY`; a bounded
    small number of batched queries total, **zero** per-agent round trips.
    Findings are never loaded into Node to be counted there.
- Definition of done: a fixture set produces per-agent run counts, cost sums,
  duration averages, decision counts, severity counts, per-model cost split,
  `last_run_at` and the trend series in a fixed number of queries independent
  of agent count; a run at exactly `start` is included and one at exactly `end`
  is excluded; an `agent_id IS NULL` run and a `status != 'done'` run are both
  absent from every returned number; `pnpm arch:check` clean.

**3. Pure shaping helpers — `AgentStats` and `AgentPerf` from the one row set.**

- Files/modules: new `server/src/modules/agents/performance.ts` (pure, no I/O,
  same contract as `helpers.ts`; a separate file keeps `helpers.ts` from
  becoming a grab bag).
- Applicable skills: `typescript-expert`, `zod`.
- Details: two projections over the **same** WI2 result —
  - `toAgentStats(...) → AgentStats` (contract adopted **unchanged**,
    `contracts/observability.ts:150-173`), `trend` projected as `StatPoint[]`
    (`{label, value}`).
  - `toAgentPerf(...) → AgentPerf`, `AgentPerfRow.trend` projected as
    `number[]` for `Sparkline`/`MetricCard` (E-3).
  - `accept_rate = accepted / (accepted + dismissed)`, **null** (never `0`)
    when the denominator is zero; `dismiss_rate` its complement on the same
    denominator (AC-12, E-10). `pending` = both `accepted_at` and
    `dismissed_at` NULL (AC-13).
  - `summary.runs` = count of the AC-8 set; `summary.total_cost_usd` = sum of
    its `cost_usd` (AC-20). `cost_by_agent` and `cost_by_model` each sum to
    `summary.total_cost_usd` (AC-21) — which requires an explicit
    **"unknown model" bucket** for runs whose `model` is NULL, or the
    reconciliation silently fails (E-11).
  - `summary.avg_accept_rate` is the **pooled** rate (total accepted / total
    decided across all counted agents), not the unweighted mean of per-agent
    rates, despite the `avg_` field name (AC-23, D-13).
  - `summary.most_active_agent` = highest run count in the counted set, ties
    broken by most recent `ran_at` (AC-24); plus the new
    `most_active_agent_id` (D-5) — `agents.name` has **no** unique constraint
    (`db/schema/agents.ts:13`), so resolving the tile's run count and accept
    rate by name is unsafe (E-5).
  - `summary.total_cost_partial = true` when any counted run has a NULL
    `cost_usd` (AC-27, D-14) — mirroring `MultiAgentRun.total_cost_partial`
    (`observability.ts:129-134`).
  - Donut colors are **not** produced here — `PerfCostSegment` is `{label,
    value}` and color is a client-side presentation concern (E-4, D-9).
- Definition of done: both projections are pure functions of the WI2 rows with
  no I/O and no second accept-rate or cost formula anywhere in the file; a
  fixture with a zero decided-findings agent yields `accept_rate: null` (not
  `0`); a fixture with a NULL-`model` run still has `cost_by_model` summing to
  `summary.total_cost_usd`; `pnpm typecheck` clean.

**4. Register `GET /agents/:id/stats` + `AgentsService` method.**

- Files/modules: `server/src/modules/agents/routes.ts` (route + the module
  docblock at lines 19-32, which lists the module's whole surface and must gain
  the new line); `server/src/modules/agents/service.ts` (a new method beside
  `stats()` at lines 202-235, delegating to WI2 via `container.reviewRepo` and
  WI3).
- Applicable skills: `fastify-best-practices`, `onion-architecture`,
  `security`.
- Details: `schema: { params: IdParams, querystring: <WI1 schema> }`; response
  is `AgentStats` **unchanged** (AC-15) — the shape its own contract header
  already assigns to this endpoint (`observability.ts:14`). Same range params
  as AC-1 (AC-16) — without this, AC-18 is not checkable at all.
  **NFR-1:** `const { workspaceId } = await getContext(app.container, req)`,
  then a workspace-scoped agent lookup; a missing-or-foreign agent throws
  `NotFoundError` → **404**, exactly as `GET /agents/:id` does at
  `routes.ts:80-85`. Never a bare `getById(id)`.
- Definition of done: the route is registered and appears in the module
  docblock; an agent belonging to another workspace 404s (does not return that
  agent's cost data); the response parses against `AgentStats`;
  `pnpm arch:check` clean.

**5. Query-plan check on the range scan; index migration only if warranted.**

- Files/modules: `server/src/db/schema/runs.ts` (only if an index is added —
  the existing index block is at lines 66-82);
  `server/src/db/migrations/**` **generated only**, via `pnpm db:generate`.
- Applicable skills: `postgresql-table-design`, `drizzle-orm-patterns`.
- Details: E-12 — the only relevant existing index is
  `agent_runs_workspace_source_ran_at_idx` on `(workspace_id, source, ran_at)`
  and, because D-16 counts CI runs alongside local ones, the query does not
  constrain `source`, so `ran_at` cannot be used as an index range. Run
  `EXPLAIN` on WI2's actual query against a realistic row count; if the plan
  shows a sequential scan, add a covering index (a `(workspace_id, ran_at)`
  shape is the obvious candidate) **via `pnpm db:generate`** and apply it with
  `pnpm db:migrate` — migrations do **not** run on boot (NFR-13, root
  `AGENTS.md`). Note that Docker/Postgres is not auto-started in this
  environment (root `INSIGHTS.md`); check `docker ps` first.
- Definition of done: the query plan is recorded in the work log with an
  explicit verdict — either "index added, migration `NNNN_*.sql` generated and
  applied" or "no index needed, plan already uses `<index>`". No hand-edited
  migration file. NFR-8 is satisfied by the measurement, not by a guessed
  latency target (D-18: no SLA is set).

#### Phase B — the dashboard endpoint (server)

**6. Additive `AgentPerf.summary` contract extension, hand-mirrored.**

- Files/modules: `server/src/vendor/shared/contracts/productionize.ts`
  (lines 174-186) **and** `client/src/vendor/shared/contracts/productionize.ts`
  — a **sanctioned do-not-touch exception**, hand-mirrored, no sync script
  exists (root `AGENTS.md`, NFR-12).
- Applicable skills: `zod`, `typescript-expert`.
- Details: add exactly two fields to `AgentPerf.summary` —
  `total_cost_partial` (D-14, mirroring `MultiAgentRun`'s
  `z.boolean().default(false)` at `observability.ts:134`) and
  `most_active_agent_id` (D-5, nullable). Nothing else. **E-14: the two copies
  have already drifted** (server has `'openrouter'` in the `provider` enum at
  line 36, client does not) — do **not** fix or widen that drift as a side
  effect, and do not use `git diff --no-index` on the whole file as the mirror
  check. Note the known ripple documented in root `INSIGHTS.md` (2026-08-13):
  a new field with a `.default()` shows up in the schema's **output** type, so
  every hand-built object literal typed against it needs the field.
- Definition of done: the added hunk is byte-identical in both vendored copies;
  no other line in either file changed (`git diff` on the two files shows only
  the two new fields); `pnpm typecheck` clean in **both** packages.

**7. Register `GET /agents/performance` + `AgentsService` method.**

- Files/modules: `server/src/modules/agents/routes.ts`;
  `server/src/modules/agents/service.ts`.
- Applicable skills: `fastify-best-practices`, `onion-architecture`,
  `security`.
- Details: returns `AgentPerf` (AC-19), already exported from both barrels
  (`vendor/shared/index.ts:26`). Same WI1 range schema. Calls the **same** WI2
  query and WI3 shaping — the service method differs from WI4's only in
  passing the workspace's agent ids instead of one, and in which projection it
  returns (AC-7). One row per workspace agent, including agents with zero runs
  in the range (AC-28, AC-37 — a zero row, `accept_rate: null`, not `0%`).
  Route ordering is a non-issue: `/agents/performance` sits alongside
  `/agents/:id` exactly as `/agents/stats` already does — Fastify's radix
  router prefers the static segment regardless of registration order
  (`routes.ts:87-90`). **NFR-1:** workspace-scoped via `getContext`.
  **NFR-6:** no provider key or token in the response; `provider`/`model` are
  non-secret identifiers. Add the route to the module docblock.
- Definition of done: response parses against the extended `AgentPerf`;
  `cost_by_agent` and `cost_by_model` each sum to `summary.total_cost_usd` on a
  fixture; an agent with no runs in the range appears as a zero row;
  `pnpm arch:check` clean.

#### Phase C — the per-agent Stats tab (client)

**8. `useAgentDetailStats` hook.**

- Files/modules: `client/src/lib/hooks/agents.ts` (the natural home — it
  already owns `useAgent`/`useAgents`); `client/src/lib/hooks/index.ts` needs
  no edit (it already `export *`s `./agents`).
- Applicable skills: `react-best-practices`, `typescript-expert`.
- Details: `GET /agents/:id/stats`, typed against `AgentStats` from
  `@devdigest/shared` — which is correct here **only because** WI4 implements
  exactly that contract. **Do not name it `useAgentStats`**: that name is
  already exported by `lib/hooks/multi-agent.ts` for the *different*
  `GET /agents/stats` endpoint, and `hooks/index.ts` re-exports both files with
  `export *` (see Recommendations §1). Carry the range as part of the query key
  so switching range refetches. Add a short comment tracing the response type
  to the handler that implements the route — E-1 / `client/INSIGHTS.md`'s
  lesson, made worse here by three similarly-named shapes being live at once.
- Definition of done: the hook exists, does not collide in the barrel, and its
  response type traces to WI4's handler; `pnpm typecheck` clean in `client/`.

**9. `Stats` tab in `AgentEditor`.**

- Files/modules: new
  `client/src/app/agents/[id]/_components/AgentEditor/_components/StatsTab/`
  (`StatsTab.tsx`, `index.ts`, `styles.ts`, `helpers.ts` as needed — the shape
  every sibling tab uses, e.g. `CiTab/`, `ContextTab/`);
  `client/src/app/agents/[id]/_components/AgentEditor/constants.ts` (add the
  `stats` entry to `TABS`);
  `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx` (mount
  it in the tab switch).
- Applicable skills: `react-project-structure`, `react-best-practices`,
  `react-testing-library`, `next-best-practices`.
- Details: the `TABS` entry uses the **already-translated**
  `editor.tabs.stats` label (`messages/en/agents.json:51`); `TAB_KEYS` derives
  from `TABS` and needs no separate edit (`constants.ts:19-22`, AC-17). Range
  selector (1d / 30d / custom) reflected in the URL as `?range=` (AC-6) — the
  page's existing `setTab` at `client/src/app/agents/[id]/page.tsx:28-32`
  already preserves other query params via
  `new URLSearchParams(search.toString())`, so `?tab=stats&range=30d` survives
  tab switches. Render: runs, cost (labeled an **estimate**, never
  billed/actual — AC-26, G-5), avg latency, accept rate **with its decided
  denominator** (US-5), severity breakdown, trend. Three visually distinct
  loading / empty / error states (AC-33); **no numeric value rendered while
  in flight** — no zeros, no dashes-as-data, no stale-but-unlabeled figures
  (AC-34, NFR-7). Accept rate is a live snapshot, not frozen history — the
  copy must not imply otherwise (E-6, AC-14). No write action of any kind on
  runs, findings, or agents (AC-39). UI only from the `@devdigest/ui` barrel.
- Definition of done: the tab renders from the new hook; `?tab=stats&range=1d`
  loads that tab at that range on a cold reload; loading state renders no
  number; the accept-rate denominator is visible; `pnpm typecheck` and
  `pnpm test` clean in `client/` (including `src/test/smoke.test.tsx`, which
  mounts `/showcase` and fails on any broken component export).

#### Phase D — the dashboard page (client)

**10. `useAgentPerf` hook.**

- Files/modules: `client/src/lib/hooks/agents.ts` (or a new
  `client/src/lib/hooks/agent-performance.ts` added to
  `client/src/lib/hooks/index.ts` — implementer's call).
- Applicable skills: `react-best-practices`, `typescript-expert`.
- Details: `GET /agents/performance`, typed against the **extended** `AgentPerf`
  from `@devdigest/shared` (WI6), range in the query key. Same E-1 discipline:
  a comment tracing the type to WI7's handler.
- Definition of done: hook exists, type traces to WI7, no barrel collision.

**11. `/agent-performance` page + `AgentPerformanceView`.**

- Files/modules: new thin `client/src/app/agent-performance/page.tsx`
  delegating to a new
  `client/src/app/agent-performance/_components/AgentPerformanceView/`
  (`AgentPerformanceView.tsx`, `helpers.ts`, `styles.ts`, `index.ts`) —
  exactly the `/ci-runs` shape (`client/src/app/ci-runs/page.tsx` →
  `_components/CiRunsView/`, AC-42).
- Applicable skills: `react-project-structure`, `react-best-practices`,
  `next-best-practices`, `react-testing-library`.
- Details:
  - Four tiles (AC-25): Total runs; Total cost — labeled an **estimate**
    (AC-26) and, per D-12, as total *attributable* spend, plus the partial-cost
    badge when `total_cost_partial` (AC-27); Avg accept rate **with its
    decided-findings denominator** (AC-23/AC-25, US-5); Most-active agent
    **with its run count and accept rate**, resolved via
    `most_active_agent_id`, never by name (D-5, E-5).
  - Two cost donuts, by agent and by model, with colors assigned **client-side**
    — `PerfCostSegment` carries no color and `DonutSegment`
    (`src/vendor/ui/charts/Donut.tsx`) requires one (E-4). Reuse `MetricCard`,
    `Donut`, `Sparkline`, `BarRow` **through the `@devdigest/ui` barrel** —
    never `src/vendor/ui/charts/*` directly, never `recharts` directly
    (`client/AGENTS.md`).
  - Per-agent table: Agent, Runs, Avg cost, Avg duration, Accept rate, Last run,
    View (AC-28); `last_run_at` from the existing contract field (AC-29); View
    links to `/agents/<id>?tab=stats&range=<current range>` so AC-18's
    reconciliation is one click away and like-for-like (AC-30).
  - **AC-31 ranking rule as a pure exported comparator in `helpers.ts`**: an
    agent with fewer than **5** decided findings (`accepted + dismissed`, both
    already on `AgentPerfRow` — see Recommendations §2) is marked low-confidence
    and **excluded from accept-rate ranking**, placed in a clearly-flagged
    group rather than interleaved by an unreliable percentage (D-15). When
    *every* agent is below the threshold the sort stays operable and says so
    (AC-32).
  - Range selector reflected in the URL as `?range=` on this page too (AC-6);
    every number on the page — tiles, table, both donuts — moves together with
    it (US-2).
  - States (AC-33): loading renders **no** numeric value (AC-34); failure
    renders the already-translated `loadError`
    (`messages/en/agentPerformance.json:4`) and renders **no** tiles, table or
    donuts (AC-35, NFR-7); a workspace with no counted run in the range renders
    the already-translated empty state (`agentPerformance.json:27-30`, AC-36) —
    **visibly different** from an agent's zero row inside an otherwise populated
    table (AC-37, US-6).
  - Agent names and model strings render as untrusted text through default JSX
    escaping; no `dangerouslySetInnerHTML` (NFR-5). No write action anywhere on
    the page (AC-39).
- Definition of done: the page renders through `AppShell` with the four tiles,
  both donuts and the table; sorting by accept rate places a 1-decision 100%
  agent in the flagged group rather than at the top; the whole-workspace empty
  state and a zero-run agent row are distinguishable; View navigates to
  `/agents/<id>?tab=stats&range=<same range>`; `pnpm typecheck` clean.

**12. i18n — extend `agentPerformance.json` (and `agents.json` if needed).**

- Files/modules: `client/messages/en/agentPerformance.json` (only an `en`
  locale exists); `client/messages/en/agents.json` only if the Stats tab needs
  keys beyond the existing `editor.tabs.stats`.
- Applicable skills: none (content), but see `react-project-structure` for
  where the keys are consumed.
- Details: E-13 — the pre-authored table keys (`agent`/`accept`/`runs`/
  `findings`/`cost`/`trend`, lines 19-26) do **not** match AC-28's columns, and
  there is no range copy at all. **Extend the file to fit the requirement; do
  not bend AC-28 to fit the existing keys** (the same call SPEC-04 made at its
  E-16). Needed additions include: avg-duration, last-run and view column
  labels; range-selector copy (1 day / 30 days / custom, plus validation
  messaging for AC-4's 422); the cost-estimate and attributable-spend labels
  (AC-26, D-12); the partial-total badge (AC-27); the low-confidence /
  not-rankable copy (AC-31, AC-32); and the per-agent zero-run row treatment
  (AC-37). Reuse `loadError` and `empty.*` as-is — they already exist.
- Definition of done: every string rendered by WI9/WI11 resolves from a message
  key; no hard-coded user-facing English in a component; existing keys reused
  where they already fit.

**13. Nav entry + shortcut + nav test.**

- Files/modules: `client/src/vendor/ui/nav.ts` (**sanctioned do-not-touch
  exception**, per the `multi-agent` precedent in `client/INSIGHTS.md`) — the
  `GLOBAL` group at lines 70-81 and the `SHORTCUTS` array at lines 104-119;
  `client/src/components/app-shell/nav.test.ts` (extend the existing
  `onboarding-tour` registry test — note it deliberately imports `NAV` through
  the `@devdigest/ui` barrel, never the vendor file).
- Applicable skills: `react-project-structure`, `react-testing-library`.
- Details: exactly one `NAV` entry in the **GLOBAL** group —
  `key: "agent-performance"`, `label: "Agent Performance"`, `icon: "BarChart"`,
  `href: "/agent-performance"` (no `:repoId` token — workspace-wide, not
  repo-scoped), `gKey: "f"` — plus the matching `SHORTCUTS` row (AC-40, D-10).
  `f`, `BarChart` and `/agent-performance` are each confirmed unused today.
  **`activeKeyFor` needs no change** (AC-41): `helpers.ts:47` already maps
  `/agent-performance` → `"agent-performance"`, and the earlier
  `startsWith("/agents")` branch at line 38 does not match `/agent-performance`
  (the 7th character is `-`, not `s`); `messages/en/shell.json:27` already has
  the label. Verify both rather than assuming.
- Definition of done: the entry exists exactly once, in GLOBAL, with no
  `:repoId` token and no `gKey`/`icon`/`href` collision; the sidebar item
  highlights on `/agent-performance` **and** `/agents/:id` still highlights
  `agents`; `nav.test.ts` covers the new entry; `pnpm test` clean in `client/`.

### Test plan

Exact commands, taken from each package's `AGENTS.md` and `package.json` —
nothing invented. Run from the package directory.

**server/**

- Typecheck: `pnpm typecheck`
- Architecture: `pnpm arch:check`
- Unit: `pnpm exec vitest run --exclude '**/*.it.test.ts'`
- Integration (needs Postgres — check `docker ps` first, Docker Desktop is not
  auto-started here): `pnpm exec vitest run .it.test`
- Both: `pnpm test`
- Migration, only if WI5 adds an index: `pnpm db:generate` then
  `pnpm db:migrate` (never applied on boot).

**client/**

- Typecheck: `pnpm typecheck`
- Tests: `pnpm test`

**Fallback** if `pnpm` aborts with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`
(root `INSIGHTS.md`, Tool & Library Notes): call the extensionless bin shim
directly under the Bash tool — `./node_modules/.bin/tsc --noEmit -p tsconfig.json`,
`./node_modules/.bin/vitest run`, `./node_modules/.bin/depcruise --config .dependency-cruiser.cjs src`.

**Coverage `test-writer` must add** (spec-mandated; `implementer` does not
author these under multi-agent mode, so they are recorded here so the
requirement is not lost in the handoff — each is the spec's own *verify* note):

- **AC-18 — the spec's central check.** Integration test hitting both endpoints
  with one fixture and asserting `runs`, `avg_cost_usd`, `avg_latency_ms` and
  `accept_rate` are **field-by-field equal** for the same agent and range.
- **AC-7** — unit test feeding one fixture run-set through both call shapes
  (single agent id vs. the workspace's agents) and asserting identical
  per-agent numbers; plus a grep-level check that no second accept-rate or cost
  formula exists in the codebase.
- **AC-8** — unit test asserting tiles, table rows and both donuts all sum from
  the same fixture run set.
- **AC-2** — integration test with runs straddling a range boundary
  (`ran_at == start` included, `ran_at == end` excluded — AC-3).
- **AC-11** — integration test asserting a **local** run contributes a non-zero
  severity breakdown (proves the join is used, not the CI-only denormalized
  columns).
- **AC-21** — property-style unit test over fixtures: `cost_by_agent` and
  `cost_by_model` each sum to `summary.total_cost_usd`, including a fixture
  with a NULL-`model` run (E-11).
- **AC-31** — unit test on the sort comparator with a 1-decision, 100%-accept
  agent, asserting it lands in the flagged group and not at the top; plus
  AC-32's all-below-threshold case.
- **AC-37** — component test asserting the whole-page empty state (AC-36) and a
  zero-run agent row render **distinguishable** output.
- **AC-38** — integration test asserting **zero** calls on a spy
  `container.llm` / `container.embedder` across a full page-load request
  sequence (load, change range, sort).
- **NFR-1** — integration test: `GET /agents/:id/stats` for an agent in another
  workspace returns **404**, not that agent's cost data.
- **AC-4 / NFR-2** — route test: `start > end` and a 367-day span each return
  **422**.
- **AC-9 / AC-12** — unit tests: an `agent_id IS NULL` run contributes to no
  total; a zero-decided-findings agent yields `accept_rate: null`, never `0`.

### Risks / Open questions

- **`client/INSIGHTS.md` is factually wrong about where the nav precedent
  landed.** Its 2026-08-22/23 entry says the `multi-agent` entry was added to
  the "WORKSPACE group"; `client/src/vendor/ui/nav.ts:70-81` actually has it in
  **GLOBAL**. Code is ground truth and AC-40 targets GLOBAL (E-17). I cannot
  edit `INSIGHTS.md` — my write scope is `docs/plans/` only. `implementer`
  updates `INSIGHTS.md` at session end and should correct that sentence then.
- **WI5 may find no index is needed, or may need one this plan cannot
  pre-specify.** E-12's analysis says the existing composite index can't serve
  this scan, but the actual verdict depends on a real `EXPLAIN` against real
  row counts, which needs Docker/Postgres running. If Postgres is unavailable
  in the implementation session, WI5 must be reported as **blocked and not
  silently skipped** (the SPEC-01 WI13 / L06 WI16 precedent), not guessed at by
  adding an index speculatively.
- **`AgentStats` has no `total_cost_partial` equivalent.** AC-27's partial-cost
  flag is added to `AgentPerf.summary` only (D-14). The Stats tab therefore has
  no contract-level way to say "this agent's total is an under-count" for the
  same NULL-`cost_usd` reason. This is a real asymmetry between the two
  surfaces that AC-18 does not cover (it checks `runs`/`avg_cost_usd`/
  `avg_latency_ms`/`accept_rate`, not `total_cost_usd`). `implementer` must not
  silently resolve it by extending `AgentStats` — AC-15 says that contract is
  adopted **unchanged**. Flag it for the user / a follow-up if the Stats tab's
  cost display turns out to need the caveat.
- **`lib/api.ts` still does zero runtime validation (`as T`).** Nothing in this
  plan changes that, so a hook/handler shape mismatch will again fail silently
  as `undefined` rather than throwing (E-1). The mitigation here is discipline
  (WI8/WI10's type-tracing comments) plus `test-writer`'s coverage, not a
  runtime guard. Adding `.parse()` to the fetch wrapper is out of scope and
  would be a repo-wide change.
- **The spec is `Status: draft`.** It is treated as authoritative here per the
  user's confirmation that all nine open questions were resolved into D-11…D-19
  and that both surfaces ship together. If the spec's status or any decision
  changes mid-implementation, this plan needs re-running, not patching.
- **`total_cost_usd` is total *attributable* spend, not total spend.** D-12
  excludes runs orphaned by a deleted agent, and D-17 excludes failed and
  cancelled runs — so real money spent is invisible on both surfaces. This is a
  recorded, accepted consequence, and AC-26/D-12's labeling is what makes it
  honest rather than a misreporting bug. It must not be "fixed" during
  implementation by quietly including those runs.

### Explicitly out of scope

Architecture review and spec-compliance verification are `plan-verifier`'s
Phases 2 and 1; new test authoring is `test-writer`'s; user-facing
documentation (a `docs/features/*` page, a `docs/reference/*-api.md` page, and
the root `AGENTS.md` docs-index entries this feature will need) is
`doc-writer`'s. See [`agents/README.md`](../../agents/README.md#handoff-chain).
