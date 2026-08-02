# e2e — `@devdigest/e2e`

Deterministic browser e2e via the `agent-browser` CDP CLI, against the real
stack (client + API + seeded DB). No LLM calls. See [README.md](README.md).

**Before starting work:** read [INSIGHTS.md](INSIGHTS.md) — treat its
entries as high-confidence guidance unless this file says otherwise.

**Stack:** dev-only deps (`tsx`, `typescript`); `agent-browser` is an external
CLI binary, not an npm dependency.

**Commands:** `npm test` (`tsx run.ts`) · `typecheck` · `npm run e2e:hermetic`
(`../scripts/e2e.sh` — isolated Postgres/API/web on ports 5433/3101/3100;
**local convenience only, not used in CI** — CI runs `npm test` directly
against its own stack).

## Map

- `run.ts` — the runner; executes `agent-browser` shell commands via
  `execFile`, one persistent browser session per flow.
- `lib/assert.ts` — helpers (`resolveArgs`, `stdoutContains`, `summarize`) and
  the `Flow`/`FlowResult`/`StepResult` types.
- `specs/*.flow.json` — 7 numbered flows (`01-app-boot` … `07-settings`), run
  in lexical filename order.
- `agent-browser.json` — `{headed: false, ignoreHttpsErrors: false}`.

## Non-default conventions

- Specs are named `NN-name.flow.json`, **not** `*.test.ts` — a different
  naming convention than every other package in this repo.
- Determinism comes from targeting a **fixed seeded demo repo** (read-only
  data) plus `wait --text`/`wait --url` primitives — not from mocking an LLM.
  Nothing here triggers an LLM call or needs an API key.

## Gotchas

- A `wait` step whose condition never becomes true fails that step (and the
  flow) with **no retry/polling logic** in the runner itself.
- On any step failure, a screenshot is best-effort saved to
  `e2e/test-results/<flow-id>-fail.png`.
- Env overrides: `E2E_BASE_URL` (default `http://localhost:3000`),
  `AGENT_BROWSER_BIN` (default `agent-browser`), `E2E_STEP_TIMEOUT`
  (default `60000`ms).

## Do-not-touch

None.

## Docs

- [README.md](README.md) — flow list and runner details.
- [TESTING.md](../TESTING.md) — where e2e fits in the overall test strategy.
- [INSIGHTS.md](INSIGHTS.md) — the "why" behind the decisions above.

**Before ending a session:** update INSIGHTS.md with anything non-obvious
you learned — don't skip this step (`engineering-insights` skill).
