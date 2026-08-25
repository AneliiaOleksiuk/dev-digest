# Development Plan: SPEC-04 — Multi-Agent Review with live statuses

Source spec: [`specs/SPEC-04-multi-agent-review.md`](../../specs/SPEC-04-multi-agent-review.md)
(finalized/committed at `d9dc38a` / `92617ab` — read it in full; this plan does
not restate its ACs, it schedules them.)

## Objective

Let a reviewer pick an explicit **subset** of workspace agents, run them
**concurrently** against one PR as a single addressable batch grouped under a
`multi_agent_runs` parent, and read the result as per-agent live columns plus
two **derived** (never persisted) views over the batch's findings — grouped
near-duplicates and a "where agents disagree" block that treats "did not flag"
as a first-class verdict — with `Learn → memory` and `Turn into eval case`
actions on individual findings.

## Scope

- **Packages/modules touched:** `server/` (schema + generated migration, both
  vendored contract copies, new files under `src/modules/reviews/`, small
  additions to `src/modules/agents/`, seed + seed prompts) · `client/` (new
  `/repos/[repoId]/multi-agent` route tree, new hooks file, `messages/en/runs.json`,
  one PR-page entry point, `src/vendor/ui/nav.ts`) · `docs/agent-prompts/`
  (three new persona mirrors).
- **Execution mode:** **multi-agent** — the full handoff chain from
  [`agents/README.md`](../../agents/README.md)#handoff-chain
  (`implementer` → `test-writer` → `plan-verifier` → `doc-writer`, each a
  separate invocation), run via the `run-plan` skill. Test authorship and
  documentation are therefore **not** work items here; each work item's
  Definition of done names the behaviour `test-writer` is expected to cover.
  Implementation is split across **four work-item groups (G1–G4) executed in
  two phases, with at most three implementer agents running at once** — see
  [Execution grouping](#execution-grouping).
- **Explicitly out of scope (feature-specific):**
  `server/src/modules/reviews/run-executor.ts` (**hard boundary** — worktree A;
  `git diff --stat` on it must stay empty, AC-10) ·
  `client/src/vendor/ui/LiveLogStream.tsx` and
  `client/.../RunTraceDrawer/**` internals (reused as-is, AC-18/AC-19/D-13) ·
  `RunReviewDropdown` behaviour (added-to, not replaced) ·
  `reviewer-core/`, `mcp/`, `e2e/`, `ci/` ·
  the embedder (`container.embedder()` is never called — AC-38/D-11) ·
  any Eval Dashboard page, any Memory page, any memory-retrieval/prompt-injection
  path · `'reply'` finding action (E-18, OQ-7) · cross-agent
  consensus/arbitration · any change to the grounding gate, prompt assembly, or
  `findings` schema semantics.

## Execution grouping

Four groups, chosen so no two concurrently-running implementer agents ever
write the same file. **G1 is a blocking prerequisite** (its contract and column
shapes are what G2 and G3 both build against); G2/G3/G4 then run in parallel —
**peak concurrency 3**.

| Phase | Group | Owns (exclusive file scope) | Depends on |
|---|---|---|---|
| 1 | **G1 — Schema + contracts** | `server/src/db/schema/runs.ts`, `server/src/db/schema/eval.ts`, generated `server/src/db/migrations/**`, both `*/src/vendor/shared/contracts/observability.ts` | — |
| 2 | **G2 — Server orchestration + derivation + routes** | everything under `server/src/modules/reviews/**` (except `run-executor.ts`, out of scope) and `server/src/modules/agents/**` | G1 |
| 2 | **G3 — Client UI** | `client/src/app/repos/[repoId]/multi-agent/**`, `client/src/lib/hooks/multi-agent.ts` + `hooks/index.ts`, `client/messages/en/runs.json`, `client/src/vendor/ui/nav.ts`, one file under `client/.../pulls/[number]/_components/PrDetailHeader/` | G1 |
| 2 | **G4 — Agent roster** | `server/src/db/seed-prompts.ts`, `server/src/db/seed.ts`, `docs/agent-prompts/*.md` | — (independent; sequenced into phase 2 only to keep concurrency at 3) |

**Deviation from the split suggested in the task, and why:** the `diff-loader.ts`
memoization (D-2/E-2) is scheduled in **G2, not G1**. It lives at
`server/src/modules/reviews/diff-loader.ts` — inside G2's folder — and its only
consumer is G2's fan-out. Putting it in G1 would give two groups write access to
`modules/reviews/`, which is the exact collision the grouping exists to prevent,
and would add work to the one group everything else is blocked on. G1 stays
minimal and fast on purpose.

**Boundary rules for the phase-2 agents (state these when invoking them):**
G2 must not touch `run-executor.ts`, `db/schema/**`, `db/seed*.ts`, or either
`vendor/shared/**` copy. G3 must not touch anything under `server/`. G4 must not
touch anything under `src/modules/` or `src/vendor/`.

## Constraints

**Architectural / repo rules**

- **`run-executor.ts` is not modified.** The orchestrator obtains concurrency by
  calling the existing `ReviewRunExecutor.executeRuns(workspaceId, pull, repo,
  jobs, logger)` **once per agent with a single-element `jobs` array**. This is
  also what makes AC-17 work: `RunLogger` is constructed over `jobs.map(j =>
  j.runId)` (`run-executor.ts:74-79`), so a one-job invocation gives that run its
  own private log buffer instead of the fanned-out shared one (E-3). Nobody may
  "fix" this back to a single multi-job call.
- **Onion architecture is *not* enforced by tooling here.** `server/.dependency-cruiser.cjs:10-11`
  lists `reviews` (and `agents`) in `PRE_EXISTING_MODULES`, so every rule's
  `from.pathNot` excludes them — `pnpm arch:check` will pass regardless of what
  the new files import. NFR-13's routes → service → repository split must
  therefore be held by discipline: new service files import the module
  repository, never `src/db/schema`/`src/db/client`/`drizzle-orm` directly.
  — skill: `onion-architecture`.
- **Hand-mirrored vendor files.** Any `observability.ts` edit must be applied by
  hand to both `server/src/vendor/shared/contracts/observability.ts` and
  `client/src/vendor/shared/contracts/observability.ts`; there is no sync script
  (root `AGENTS.md`). Precedent from `INSIGHTS.md` (2026-08-13): the pass
  criterion is `git diff --no-index` between the two files being empty.
- **Migrations are generated, never hand-written.** `pnpm db:generate` in
  `server/`; `server/src/db/migrations/**` is do-not-touch by hand. Migrations do
  **not** run on boot — `pnpm db:migrate` is a manual post-plan step.
- **Routes declare zod schemas** (`server/AGENTS.md`): invalid input 422s before
  the handler; no hand-rolled `Schema.parse(req.body)` inside handlers.
  — skills: `fastify-best-practices`, `zod`.
- **Client data access only via `src/lib/hooks/*`**; feature logic in colocated
  `_components/<Name>/` folders with their own tests; UI imported only from the
  `@devdigest/ui` barrel; Markdown only via the single centralized
  `src/vendor/ui/primitives/Markdown.tsx` (`client/AGENTS.md`, NFR-4).
  — skills: `react-project-structure`, `react-best-practices`, `next-best-practices`.

**Facts verified while planning (so no work item has to re-derive them)**

- `agent_runs` has **no** `multi_agent_run_id` today (`server/src/db/schema/runs.ts:8-32`);
  `multi_agent_runs` exists with exactly four columns (`:42-51`) and needs none added.
- `eval_cases.owner_kind` is `text(..., { enum: ['skill','agent'] })`
  (`server/src/db/schema/eval.ts:12`) — a Drizzle *text-with-enum*, not a
  Postgres enum type, so the migration is a check/type-free column change.
- `reviews.runId` exists (`server/src/db/schema/reviews.ts:20`) — this is the join
  path `agent_runs → reviews → findings` the batch read needs. `findings` has no
  direct run reference.
- **`FindingActionKind` is `['accept','dismiss','learn','reply']`
  (`contracts/findings.ts:82`) — there is no `'eval-case'` member.** `learn`
  therefore rides the existing `useFindingAction` hook and the `FINDING_ACTIONS`
  route loop (`modules/reviews/routes.ts:32,176-182`) once extended; **the
  eval-case route must be registered separately and needs its own client
  mutation.** Do not add `'eval-case'` to `FindingActionKind`.
- `MemorySource` is `{ pr: number|nullish, context: string }`
  (`contracts/knowledge.ts:116-119`) — `context` is the only free-form field.
- `p-queue@8` is already a server dependency and already used with
  `concurrency: opts.concurrency ?? 3` (`server/src/platform/jobs.ts:1,40`).
- `activeKeyFor` already maps `/multi-agent` (`client/src/components/app-shell/helpers.ts:28`)
  and `shell.json:26` already names it, but **`NAV` has no `multi-agent` item**
  (`client/src/vendor/ui/nav.ts:21-56`) — the screen has no sidebar entry today.
- `GET /agents/stats` vs the existing `GET /agents/:id` (`modules/agents/routes.ts:79`)
  is **not** a routing conflict — Fastify's radix router prefers the static
  segment. No registration-order workaround is needed; don't invent one.

**Relevant INSIGHTS.md entries**

- Root `INSIGHTS.md` → *Tool & Library Notes*: `pnpm <script>` can abort with
  `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` in this environment; under the
  Bash tool use the **extensionless** shim (`./node_modules/.bin/vitest`,
  `./node_modules/.bin/tsc`) rather than `pnpm exec`.
- Root `INSIGHTS.md` → *Tool & Library Notes*: Docker Desktop is not
  auto-started; `server/` tests needing Postgres and any live end-to-end check
  are unavailable until it is launched. Check `docker ps` before claiming a live
  verification.
- Root `INSIGHTS.md` → *Session Notes* (2026-08-14, Track B): SPEC-02's
  `plan-verifier` **FAIL** was caused by the drizzle migration **journal and
  snapshots never being committed**, so the feature's columns did not exist on a
  fresh checkout. WI1's Definition of done makes committing the full generated
  artifact set explicit.
- Root `INSIGHTS.md` → *Session Notes* (2026-08-13): extending a Zod contract
  with a non-optional-`.default()` field ripples into every **hand-built object
  literal** typed against that schema's output — on both sides. WI2 adds exactly
  such a field (`groups`, and the partial-cost flag), so expect fallout in
  server DTO builders and client test fixtures.
- Root `INSIGHTS.md` → *Session Notes* (2026-08-02): this environment's OpenAI
  and Anthropic keys have been exhausted before; only OpenRouter worked. Check
  `POST /settings/test-connection` per provider before diagnosing the manual
  verification scenario as a code bug.
- Root `INSIGHTS.md` → *Recurring Errors & Fixes*: `git commit` with no pathspec
  commits the **whole staged index**. With three implementer agents landing work
  in phase 2, always commit with explicit paths.

## Recommendations

1. **Bound the `diff-loader` memoization cache (WI3).** The spec prescribes "an
   in-memory `Map` keyed by `pullId:headSha`" and stops there. In a long-lived
   `pnpm dev` / production API process that `Map` never evicts, and each entry
   holds a whole `UnifiedDiff` — an unbounded leak keyed by an ever-growing set
   of head SHAs. Recommend a small explicit bound (max ~16 entries, oldest-out,
   or a short TTL of a few minutes) plus an exported `clear()` for tests. Still
   "a handful of lines in one file"; still satisfies E-2 (the fan-out's N calls
   all land inside one batch's lifetime).
2. **AC-39's idempotency key does not exist yet — put the finding id in
   `MemorySource.context` (WI9).** AC-36 specifies `sources` = one
   `MemorySource` naming "the PR number and the originating `file:line` +
   agent", and the spec forbids a `memory` schema change. With only that, there
   is **no way to answer "was this finding already learned?"** — `file:line` +
   agent is not unique across runs of the same agent on the same PR. Recommend
   `context` carry a machine-readable finding-id token (e.g.
   `finding:<uuid> · <file>:<line> · <agent name>`) and the idempotency lookup
   query `memory` on `workspaceId` + `kind='learning'` + a `sources` jsonb match
   on that token. Keeps AC-36, AC-39 and "no memory schema change" all true at
   once. If `implementer` prefers a dedicated `sources[].finding_id` field on
   the `MemorySource` **contract** instead, that is an equally acceptable
   answer — but it is a contract edit, so it must move into **G1/WI2** and be
   mirrored, not done ad hoc in G2.
3. **Add an index on `agent_runs.multi_agent_run_id` (WI1).** Every batch read
   (`GET /multi-agent-runs/:id`) selects children by parent id, on the table
   that already grows fastest in this schema. One `index()` in the Drizzle table
   definition, picked up by the same `pnpm db:generate` run — free now,
   awkward later. — skill: `postgresql-table-design`.
4. **Give the screen a sidebar entry (WI14).** AC-2 requires the configure-run
   screen to work "without a PR in context" and to present a PR selector — which
   only makes sense if the screen is reachable *without* coming from a PR. Today
   nothing links to it: `activeKeyFor` and `shell.json` anticipate the key, but
   `NAV` has no item. Recommend adding one to the `WORKSPACE` group with an
   `:repoId`-templated href, following the exact precedent
   `client/src/components/app-shell/nav.test.ts` documents for `onboarding-tour`.
   Note the trade-off explicitly: `client/src/vendor/ui/nav.ts` is a do-not-touch
   hand-mirrored file, and this is the second time a feature has had to edit it —
   if the user would rather keep vendor untouched, the fallback is PR-page entry
   only (AC-8) and a URL-only standalone screen, which weakens AC-2. **Flagged,
   not silently decided** — see Risks.
5. **Adopt every OQ default as written; do not re-litigate.** OQ-1 = badge the
   total as partial · OQ-2 = no bulk "dismiss all in group" · OQ-3 = per-run
   cancel only · OQ-4 = concurrency 3 (matching `JobRunner`'s default) and max
   agents per batch = the workspace's own agent count · OQ-5 = no latency SLA ·
   OQ-6 = estimates scoped to the agent's current model · OQ-7 = `'reply'` out of
   scope. These are recorded here so the batch of implementer agents all use the
   same numbers without each re-reading the spec's Open questions section.
6. **Do not reintroduce complexity the spec's second pass removed.** One
   per-location index with two filters (D-14), not two matching engines; one
   shared `openRunId` + one `RunTraceDrawer` mount (D-13), not per-column
   instances; `embedding: null` with **zero** embedder calls (D-11); ordering
   (`await getOrClassify` before fan-out), not locking (D-2/E-1).

## Work items

### G1 — Schema + contracts *(phase 1, blocking; one implementer)*

**1. Add `agent_runs.multi_agent_run_id` and extend `eval_cases.owner_kind`, then generate the migration.**
   - Files/modules: `server/src/db/schema/runs.ts` (nullable
     `uuid('multi_agent_run_id').references(() => multiAgentRuns.id)`, plus an
     index per Recommendation 3), `server/src/db/schema/eval.ts` (`owner_kind`
     enum → `['skill','agent','finding']`), generated
     `server/src/db/migrations/**`.
   - Applicable skills: `drizzle-orm-patterns`, `postgresql-table-design`.
   - Definition of done: `cd server && pnpm db:generate` produces the migration;
     `server/pnpm typecheck` passes; the **complete** generated artifact set —
     the `.sql` file, `meta/_journal.json`, and the new `meta/*_snapshot.json` —
     is present and staged (the SPEC-02 failure mode in INSIGHTS.md). The column
     is nullable so every pre-existing single-agent run still validates.
     No file under `migrations/` is hand-edited. `pnpm db:migrate` is **not** run
     as part of this item (manual step, see Test plan).

**2. Extend the `observability.ts` contracts, in both mirrored copies.**
   - Files/modules: `server/src/vendor/shared/contracts/observability.ts` and
     `client/src/vendor/shared/contracts/observability.ts`.
   - Changes: (a) `AgentColumn.status` → `['done','failed','running','cancelled']`
     (E-14); (b) a new `FindingGroup` schema — file, normalized file, line range,
     category, and an array of members each carrying the member finding's own
     `id`, `run_id`, `agent_id`, `agent_name`, severity, title, rationale,
     suggestion and confidence **verbatim** (AC-24 forbids paraphrase/merge);
     (c) `MultiAgentRun` += `groups: z.array(FindingGroup)` (E-15); (d) an
     additive partial-cost flag on `MultiAgentRun` for AC-15/OQ-1 (e.g.
     `total_cost_partial: z.boolean().default(false)`).
   - Applicable skills: `zod`, `typescript-expert`.
   - Definition of done: `git diff --no-index server/src/vendor/shared/contracts/observability.ts client/src/vendor/shared/contracts/observability.ts`
     is empty; both packages typecheck; every pre-existing hand-built object
     literal typed against these schemas still compiles (the `.default()` ripple
     from INSIGHTS.md). Behaviour for `test-writer`: a `'cancelled'` column and a
     `MultiAgentRun` carrying groups both parse.

### G2 — Server orchestration, derivation, routes *(phase 2; one implementer)*

**3. Memoize `loadDiff` (D-2b / E-2).**
   - Files/modules: `server/src/modules/reviews/diff-loader.ts` **only**.
   - Applicable skills: `typescript-expert`.
   - Definition of done: repeated `loadDiff` calls for the same
     `` `${pull.id}:${pull.headSha}` `` hit `container.git.diff` /
     `diffFromPrFiles` exactly once; the cache is bounded and exposes a reset for
     tests (Recommendation 1); `run-executor.ts` is untouched. Behaviour for
     `test-writer`: N calls → 1 underlying load; a different head SHA misses.

**4. Repository layer for the batch, stats, memory and eval cases.**
   - Files/modules: `server/src/modules/reviews/repository/run.repo.ts`
     (`createAgentRun` gains an optional `multiAgentRunId`; new: insert a
     `multi_agent_runs` parent, read one parent workspace-scoped, list its
     children joined to `agents` for name/provider/model, aggregate per-agent
     avg duration + avg cost scoped to the agent's **current** model per OQ-6/E-17),
     `server/src/modules/reviews/repository/review.repo.ts` (findings for a set
     of run ids, via `reviews.runId`), a new repository file for the `memory` and
     `eval_cases` writes/lookups, and the `ReviewRepository` facade in
     `server/src/modules/reviews/repository.ts`.
   - Applicable skills: `drizzle-orm-patterns`, `onion-architecture`.
   - Definition of done: every new method takes `workspaceId` as an **explicit
     parameter** (NFR-1) — never inferred inside the query; no service file
     imports Drizzle or `db/schema` directly. Behaviour for `test-writer`: a
     parent id from another workspace resolves to nothing.

**5. Multi-agent orchestration service (new file under `modules/reviews/`).**
   - Files/modules: new `server/src/modules/reviews/multi-agent-service.ts` (+
     any small pure helper file it needs), wired from
     `server/src/modules/reviews/service.ts`.
   - Behaviour: validate the agent-id set (non-empty per E-5, UUIDs, count-capped
     per OQ-4, **each verified to belong to the caller's workspace before any run
     row is created** — NFR-3); create exactly one `multi_agent_runs` row; create
     N `agent_runs` children carrying `multiAgentRunId` (AC-9); return batch id +
     child run ids **immediately**, before any agent completes (AC-12), mirroring
     `service.ts:120-143`; then, in the background, `await` **one**
     `intent.getOrClassify(...)` before fan-out (D-2a/E-1 — ordering, no locking),
     and fan out through a `p-queue` at concurrency 3, each task calling
     `executor.executeRuns(workspaceId, pull, repo, [{agent, runId}], logger)`
     with a **single-element** jobs array.
   - Applicable skills: `onion-architecture`, `typescript-expert`, `security`.
   - Definition of done: `run-executor.ts` shows no diff; one agent failing
     leaves siblings' execution and persisted rows untouched (AC-13/NFR-10); a
     one-agent batch still creates a parent (E-4); an empty set is rejected
     rather than creating an empty batch (E-5). Behaviour for `test-writer`:
     an integration test with a fake LLM adapter asserting **overlapping**
     start/end windows across three runs (AC-10), a failure injected into exactly
     one of three (AC-13), and a `git diff --stat` assertion on `run-executor.ts`.

**6. One per-location index; derive groups and conflicts from it (D-14).**
   - Files/modules: new pure helper file under
     `server/src/modules/reviews/` (no infrastructure imports).
   - Behaviour: build **one** structure mapping each flagged location →
     {participating agent → their finding, or `'ignored'`}. Path normalization
     before comparison (E-12) — comparison only, never a filesystem path (NFR-4).
     Derive **groups** by additionally requiring identical `category` and
     overlapping `[start_line,end_line]` after ±3 expansion, with the expansion
     applied **only** to findings whose own range spans ≤ 20 lines (AC-22/E-10).
     Derive **conflicts** by checking for a silent participant or a severity
     divergence (AC-30), category-agnostic (E-11). Runs whose status is `failed`
     or `cancelled` are **excluded from every take list** and never reported as
     `'ignored'` (AC-29); a successful run with zero findings **does** contribute
     `'ignored'` takes (E-13). A single-agent finding is still a group of one
     (AC-25).
   - Applicable skills: `typescript-expert`.
   - Definition of done: pure, no DB access, no mutation of any input. Behaviour
     for `test-writer`: fixture-driven unit tests covering a >20-line finding, a
     same-line/different-category pair, a `./src/x.ts` vs `src/x.ts` pair, a
     failed run, and a zero-findings run.

**7. Batch read service — assemble the `MultiAgentRun` response.**
   - Files/modules: new read/assembly file under
     `server/src/modules/reviews/`, consuming WI4 and WI6.
   - Behaviour: `total_duration_ms` = wall-clock span (first child start → last
     child finish), **not** a sum; `total_cost_usd` = sum of participating runs'
     `cost_usd`, flagged partial when any is null (AC-15, OQ-1 default = badge);
     columns carry per-agent terminal state incl. `'cancelled'` and the persisted
     `error` text (AC-20/AC-21); grouping is **derived at read time** and mutates
     nothing (AC-23/AC-32); a batch containing a reaped-stale child renders a
     mixed terminal state instead of hanging on "running" (E-8); reads are
     addressed by a **specific batch id** (E-9).
   - Applicable skills: `typescript-expert`, `zod`.
   - Definition of done: the response `MultiAgentRun.parse`s against the WI2
     contract. Behaviour for `test-writer`: `findings` row count is unchanged by
     any number of reads (AC-23); a null child `cost_usd` produces a partial
     flag, not a silent undercount.

**8. `Learn → memory` and `Turn into eval case` service logic.**
   - Files/modules: `server/src/modules/reviews/findings.ts` (extend past the
     current accept/dismiss `switch` that throws `"not available in the
     starter"`, `findings.ts:22-32`) plus a new file for the eval-case write.
   - Behaviour — **learn**: verify the finding → review → PR → workspace chain
     exactly as `findings.ts:17-20` already does (NFR-7); insert one `memory` row
     with `kind:'learning'`, `scope:'repo'`, `repoId` from the finding's PR,
     `content` derived from title + rationale + suggestion, `confidence` from the
     finding, `sources` = one `MemorySource` (AC-36 + Recommendation 2's
     finding-id token); `embedding: null` with **no** `container.embedder()` call
     (AC-38); return `memoryId` (AC-37); idempotent (AC-39); additive — never
     sets `accepted_at`/`dismissed_at` (AC-40). **eval case**: same ownership
     check; one `eval_cases` row with `ownerKind:'finding'`, `ownerId` = finding
     id, name from the finding's title, `inputDiff`/`inputFiles` from the
     finding's PR, `inputMeta` recording agent + run + head SHA, `expectedOutput`
     seeded as a draft from the finding's own severity/category/file/line/suggestion
     (AC-42); idempotent on (workspace, `ownerKind`, `ownerId`) (AC-44). Both
     **whitelist** the fields they copy — never spread a client-supplied object
     (NFR-7) — and neither may put an LLM string into a path, query or command
     (NFR-4), nor any secret into the row (NFR-6).
   - Applicable skills: `security`, `onion-architecture`, `drizzle-orm-patterns`.
   - Definition of done: learning twice returns the same `memoryId` and leaves
     one row; eval-casing twice returns the existing case. Behaviour for
     `test-writer`: a learned row's `embedding` is null **and no embedder call
     was made**; learn-then-accept both succeed on the same finding.

**9. Register the routes.**
   - Files/modules: `server/src/modules/reviews/routes.ts`,
     `server/src/modules/agents/routes.ts` (+ its `service.ts`/`repository.ts`
     for the stats aggregate).
   - Routes: `POST /pulls/:id/multi-agent-run` (zod **body** schema declared on
     the route: non-empty array of UUID agent ids, `.max()`-capped per OQ-4;
     rate limit **at least as strict** as `POST /pulls/:id/review`'s
     `{max: 10, timeWindow: '1 minute'}` — NFR-2, `routes.ts:39-45`) ·
     `GET /multi-agent-runs/:id` (workspace-scoped; a foreign id **404s**, NFR-1) ·
     `POST /findings/:id/learn` (add `'learn'` to `FINDING_ACTIONS`,
     `routes.ts:32`) · `POST /findings/:id/eval-case` (registered **separately** —
     it is not a `FindingActionKind`) · `GET /agents/stats` (one batched call
     returning the aggregate for every workspace agent).
   - Applicable skills: `fastify-best-practices`, `zod`, `security`.
   - Definition of done: handlers stay thin — no `Schema.parse(req.body)` inside
     a handler; every handler calls `getContext(container, req)` and passes
     `workspaceId` down. Behaviour for `test-writer`: an empty `agentIds` array
     422s; an agent id belonging to another workspace is rejected **before** any
     `agent_runs` row is created; a foreign batch id 404s; `GET /agents/stats`
     does not shadow `GET /agents/:id`.

### G3 — Client UI *(phase 2; one implementer)*

**10. Hooks + i18n keys.**
   - Files/modules: new `client/src/lib/hooks/multi-agent.ts` (start a batch,
     read a batch, agent stats, turn-into-eval-case mutation), exported from
     `client/src/lib/hooks/index.ts`; `client/messages/en/runs.json` — **extend**
     the `page` block at `:112-135` with subset-picker copy rather than
     repurposing `"runAll"` / `"meta"` (E-16/D-9), and keep the existing
     `noAgents` / `noRun` empty states.
   - Applicable skills: `react-best-practices`, `next-best-practices`.
   - Definition of done: no component calls `fetch` directly
     (`client/AGENTS.md`); `useFindingAction` is **reused unchanged** for
     `learn` — it already types `memoryId` in its response
     (`hooks/reviews.ts:176-192`) — and only the eval-case action gets a new
     mutation. `pnpm typecheck` passes.

**11. Configure-run screen.**
   - Files/modules: new `client/src/app/repos/[repoId]/multi-agent/page.tsx` plus
     colocated `_components/<Name>/` folders (each with its own `*.test.tsx`).
   - Behaviour: two numbered steps ("1 Pull request" / "2 Agents to run"); a PR
     selector when no PR is in context (AC-2, `runs.json` `selectPr`/`prItem`);
     one checkbox card per **every** workspace agent with no allow-list
     (AC-3/AC-47/D-12) showing name, model, enabled state and the historical
     estimate; an explicit "no estimate yet" state for agents with no completed
     run — **never a fabricated number** (AC-5); a rolled-up estimate that sums
     cost but takes the **maximum** per-agent average duration, not the sum
     (AC-6), in a pure helper; a run button carrying the live selected count and
     disabled at zero (AC-7); estimates visually distinguishable from measured
     values (AC-50 — a `≈` and a "from N past runs" affordance).
   - Applicable skills: `react-project-structure`, `react-best-practices`,
     `react-testing-library`.
   - Definition of done: the aggregation helper is pure and unit-testable.
     Behaviour for `test-writer`: `activeKeyFor('/repos/r1/multi-agent') === 'multi-agent'`
     (AC-1); max-not-sum duration with mixed averages (AC-6); zero selected →
     button disabled; an agent with no history renders the empty-estimate state.

**12. Results page — Columns view and the shared trace drawer.**
   - Files/modules: further colocated `_components/` under the same route.
   - Behaviour: two view modes, Columns and Tabs, using the existing
     `runs.json:117-120` labels (AC-16); one column per participating agent, each
     driven by **its own** run stream via `useRunEvents` for a single runId —
     `RunStatus` (`_components/RunStatus/RunStatus.tsx`) merges N runIds into one
     `LiveLogStream` and is therefore the **wrong shape**; wrap/replace it with a
     per-agent composition and leave `LiveLogStream` itself untouched
     (AC-17/AC-18); columns settle independently to verdict + 0-100 score badge +
     findings count + duration + cost (AC-20); a failed column renders the
     persisted `error` **in the column**, and the batch is not reported as failed
     (AC-21) — note the existing global-toast path (`hooks/reviews.ts:223-225`)
     would produce a toast storm with six agents, which the UX section calls a
     regression; status is never conveyed by colour alone, and six simultaneous
     polite live regions must not spam a screen reader.
   - **Trace access (D-13, AC-19/AC-34a):** the page holds **one**
     `openRunId: string | null`; every "View trace" trigger sets it; **one**
     conditionally-rendered `RunTraceDrawer` reads it. No per-column drawer
     instance, no new drawer variant, no change inside `RunTraceDrawer.tsx`.
   - Applicable skills: `react-best-practices`, `react-project-structure`,
     `react-testing-library`.
   - Definition of done: `git diff` on `client/src/vendor/ui/LiveLogStream.tsx`
     and `client/.../RunTraceDrawer/**` is empty. Behaviour for `test-writer`:
     one column finishing while others still run; a failed column showing its own
     error text; clicking "View trace" in two different columns reusing one
     drawer mount.

**13. Finding groups, the disagreement block, and the Tabs view.**
   - Files/modules: further colocated `_components/` under the same route;
     `FindingCard` (`client/.../pulls/[number]/_components/FindingCard/`) is
     **reused, not forked**, so accept/dismiss state renders identically
     (AC-34, `FindingCard.tsx:60-120`).
   - Behaviour: groups collapsed by default, one line per group naming every
     contributing agent, expanding to each agent's **verbatim** title, rationale,
     suggestion and confidence — never a merged or paraphrased rationale
     (AC-24); a single-agent finding still shown as a group of one (AC-25);
     accept/dismiss act on an **individual** finding id and never on siblings
     (AC-26), with no bulk action (OQ-2). Disagreement block: one row per
     contended location titled `file:line — title`, one cell per participating
     agent showing a severity chip or a deliberate-looking **"did not flag"**
     cell carrying the take's `note` (AC-28) — an empty cell reads as a bug;
     "Show only conflicts" toggle defaulting **off** (AC-31); UI copy must state
     that groups require the same category while shared locations do not (E-11).
     Tabs view: one tab per agent showing only that agent's findings with
     confidence, suggested fix, Accept, Dismiss, Learn and Turn-into-eval-case
     (AC-33); the active tab header offers the same "View trace" wired to the
     **same** shared `openRunId` (AC-34a). Learn sits visually apart from
     Accept/Dismiss (it is not terminal, AC-40), confirms with "Saved to memory",
     and must not promise agents will use it yet (E-20). Eval-case success is a
     lightweight notification with **no** navigation to any eval page (AC-43).
     All LLM-authored text renders through the centralized `Markdown` component,
     never `dangerouslySetInnerHTML` (NFR-4).
   - Applicable skills: `react-best-practices`, `react-project-structure`,
     `react-testing-library`, `security`.
   - Definition of done: no second `react-markdown` instance is introduced.
     Behaviour for `test-writer`: a three-agent group expanding to three verbatim
     takes; a group of one; "Show only conflicts" on/off; a `'ignored'` take
     rendering visible "did not flag" text.

**14. Entry points — PR detail page and the sidebar.**
   - Files/modules: one file under
     `client/src/app/repos/[repoId]/pulls/[number]/_components/PrDetailHeader/`;
     `client/src/vendor/ui/nav.ts` (see Recommendation 4 — **confirm with the
     user before editing this do-not-touch vendor file**; if declined, ship the
     PR entry point only and record the AC-2 gap).
   - Behaviour: the PR page offers an entry point that lands on the same screen
     with the current PR pre-selected, **alongside** and not replacing
     `RunReviewDropdown` (AC-8); both entry points reach one screen with one
     state, not two divergent flows.
   - Applicable skills: `react-project-structure`, `next-best-practices`.
   - Definition of done: `RunReviewDropdown`'s existing behaviour is unchanged.
     Behaviour for `test-writer`: if the NAV item ships, a registry test in the
     shape of `client/src/components/app-shell/nav.test.ts` (key `multi-agent`,
     correct group, `:repoId` href resolving to `/repos/repo-1/multi-agent`),
     importing `NAV` **through the `@devdigest/ui` barrel**, never the vendor
     file.

### G4 — Agent roster *(phase 2; one implementer)*

**15. Seed three new personas with mirrored prompt docs.**
   - Files/modules: `server/src/db/seed-prompts.ts` (three new exported prompt
     bodies alongside `GENERAL_REVIEWER_PROMPT` / `SECURITY_REVIEWER_PROMPT` /
     `PERFORMANCE_REVIEWER_PROMPT`), `server/src/db/seed.ts` (three entries in
     `seedAgents`, `:180-214`), three new `docs/agent-prompts/<name>.md` mirrors
     (`junior-mentor.md`, `customer-facing.md`, `architecture.md`) matching the
     existing three files' shape.
   - Behaviour: **Junior Mentor**, **Customer-Facing**, **Architecture** (D-5),
     each with a distinct verdict focus — the configure-run cards show a one-line
     summary per agent, so the descriptions must actually differentiate. Seeding
     stays idempotent via the existing name-lookup-then-insert guard
     (`seed.ts:214+`), so re-running creates no duplicates (AC-46).
   - Applicable skills: `typescript-expert`; read
     [`docs/agent-prompts/README.md`](../agent-prompts/README.md) before writing
     any prompt body (root `AGENTS.md` requires it for anything prompt-related).
   - Definition of done: `pnpm db:seed` run twice yields six agents, not nine;
     each new persona's prompt body and its `docs/agent-prompts/*.md` mirror are
     identical in content. Behaviour for `test-writer`: idempotent re-seed.

## Test plan

Per-package commands, taken from each package's `AGENTS.md` — do not invent
others. Under the Bash tool prefer the extensionless shim
(`./node_modules/.bin/vitest run`) per root `INSIGHTS.md`.

**server/** (`cd server`)
- `pnpm typecheck`
- `pnpm arch:check` — passes trivially for `modules/reviews`/`modules/agents`
  (both in `PRE_EXISTING_MODULES`); run it anyway to catch collateral damage.
- unit: `pnpm exec vitest run --exclude '**/*.it.test.ts'`
- integration: `pnpm exec vitest run .it.test`
- both: `pnpm test`

**client/** (`cd client`)
- `pnpm typecheck`
- `pnpm test`

**Manual, after the plan is executed (not part of any work item's DoD):**
- `cd server && pnpm db:migrate` — migrations are **not** applied on boot (root
  `AGENTS.md`). Requires Docker/Postgres up (`docker ps` first).
- `cd server && pnpm db:seed` — twice, to confirm AC-46.
- The spec's **Manual verification scenario** (three real agents on a demo PR,
  then the same PR with one agent, recording the *actual* measured wall-clock and
  cost of both and their real ratio). Its result must be **recorded, not
  assumed** — and per the spec, a ratio that is not 3× is a passing result;
  fabricating 3× is a failure.

## Risks / Open questions

- **AC-39 has no idempotency key as specified.** See Recommendation 2. The plan
  proposes putting a finding-id token in `MemorySource.context`; if `implementer`
  instead wants a typed `finding_id` on the `MemorySource` **contract**, that is
  a G1/WI2 contract edit requiring both mirrors — it must **not** be improvised
  inside G2. Either way, `implementer` must not silently ship a learn route that
  can create duplicate rows.
- **Editing `client/src/vendor/ui/nav.ts` (WI14).** It is a do-not-touch
  hand-mirrored file, but there is a direct in-repo precedent
  (`onboarding-tour`) and AC-2 is weakened without a sidebar entry. **Needs a
  user decision before the file is edited** — this is the one item in the plan
  that knowingly touches a do-not-touch path.
- **NFR-13's claim that onion architecture is "enforced by `pnpm arch:check`" is
  false for this feature.** `reviews` and `agents` are both in
  `PRE_EXISTING_MODULES` (`server/.dependency-cruiser.cjs:10-11`), so nothing
  mechanically checks the new files' imports. `plan-verifier` should treat the
  layering as a **manual** Phase 2 review point, not a green `arch:check` run.
  (Recorded here rather than fixed: this planner cannot edit `INSIGHTS.md`.)
- **Contract `.default()` ripple (WI2).** Adding `groups` and the partial-cost
  flag will break hand-built object literals typed against `MultiAgentRun` on
  both sides. G1's implementer must expect fallout beyond the two contract files
  and must fix it inside G1, before G2/G3 start — otherwise two phase-2 agents
  will independently hit the same red typecheck.
- **Estimate quality is unmeasured.** OQ-6's "current model only" scoping means a
  freshly-edited agent silently drops to "no estimate yet" (AC-5). Correct per
  E-17, but it will look like a bug during the demo; do not "fix" it by widening
  the average.
- **Live verification is environment-gated.** Docker is not auto-started here,
  and this environment's OpenAI/Anthropic keys have been exhausted before (root
  `INSIGHTS.md`). If the manual scenario cannot run, say so explicitly rather
  than reporting a fabricated or typecheck-only result.
- **Multi-replica correctness is out of scope and must not be claimed** —
  `runBus` is in-memory and `reapStaleRuns()` assumes a single API process
  (NFR-12, `server/AGENTS.md`). A batch is bound to one process.
- **Three concurrent implementer agents commit into one worktree.** Per root
  `INSIGHTS.md`, `git commit` with no pathspec commits the whole staged index —
  every phase-2 commit must name explicit paths.
- **No blocking question remains.** The spec's OQ-1..OQ-7 all carry defaults
  (adopted verbatim in Recommendation 5), the execution mode was delegated to
  this planner by the requester, and no work item requires a guess to start.

## Explicitly out of scope

Architecture review, spec-compliance verification, test authorship, and
documentation are owned by the downstream agents in the handoff chain — see
[`agents/README.md`](../../agents/README.md)#handoff-chain.
