# evals/baselines

Committed baseline snapshots, one per suite pattern, used by `pnpm eval:report` in CI to publish
a "vs baseline" comparison in the job summary. Unlike `results/` (gitignored, ephemeral), these
files are **tracked** — the calibration is part of the PR diff, reviewable like any other change.

## Creating / recalibrating one

Required whenever a `*.cases.ts` case or a `scoring/*` grader changes (see the routing table in
the root [AGENTS.md](../../AGENTS.md)):

```bash
pnpm eval:repeat skills/onion-architecture -n 2 --label baseline --commit
git add evals/baselines/skills-onion-architecture.json
```

`--commit` writes the same aggregate `eval:repeat` already saves to `results/repeat-<label>.json`
(local, gitignored) *also* to `evals/baselines/<slug>.json` (tracked). The slug is the pattern
argument with `/` and `\` turned into `-` — must match how `pnpm eval:report <pattern>` looks the
file up (`src/report.ts`'s `slugify()`).

## File shape

```jsonc
{
  "label": "baseline",
  "pattern": "skills/onion-architecture",
  "git_sha": "...",
  "calibrated_at": "2026-08-20T12:00:00.000Z",
  "tests": { "<nodeid>": { "pass": { "passed": 2, "total": 2, "rate": 1 }, "practices": {...}, "metrics": {...} } }
}
```

`tests` is the same `Record<string, NodeAggregate>` shape `eval:repeat` prints — see
`src/records/stats.ts`.
