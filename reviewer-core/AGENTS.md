# reviewer-core — `@devdigest/reviewer-core`

Pure review engine: diff → prompt → LLM → grounded findings. No database,
GitHub, or filesystem access — the only side effect is an LLM call through an
injected `LLMProvider`. See [README.md](README.md) for the pipeline diagram.

**Before starting work:** read [INSIGHTS.md](INSIGHTS.md) — treat its
entries as high-confidence guidance unless this file says otherwise.

**Stack:** `openai` SDK 4.77 (OpenAI-compatible client, used for OpenRouter),
zod 3.24, typescript 5.7, vitest 2.1.

**Commands:** `typecheck` (= `build` — the package **never emits JS**, its
build script is just `tsc --noEmit`) · `test` (`vitest run`).

## Map

- `src/prompt.ts` — `assemblePrompt()`, `wrapUntrusted()` + `INJECTION_GUARD`.
- `src/grounding.ts` — `groundFindings()`, the mandatory citation gate.
- `src/llm/` — `openrouter.ts` (`LLMProvider` impl), `structured.ts` (Zod →
  JSON Schema, parse-with-repair).
- `src/review/` — `run.ts` (single-pass orchestration), `reduce.ts`
  (map-reduce path for large diffs).
- `src/output/to-review.ts` — CI payload helper (`toReview`).
- `src/index.ts` — the public API surface; everything else is internal.

## Non-default conventions

- The server consumes this package's **raw TypeScript source** directly via a
  tsconfig path alias (`@devdigest/reviewer-core` → `../reviewer-core/src`) —
  not a built/published artifact.
- Changing the public API means updating **both** `src/index.ts`'s exports and
  every import site in `server/`.
- Every finding must cite a line that exists in the diff or `groundFindings`
  drops it; the score is always recomputed from surviving findings, never
  trusted from the model's own output.

## Gotchas

- This is the **only package in the repo on npm** (`package-lock.json`) —
  every other package is pnpm. Don't "fix" the lockfile; it's intentional.
- If `reviewer-core/node_modules` is missing, the API crashes at boot with
  `ERR_MODULE_NOT_FOUND` (since the server imports the source directly, not a
  built package).

## Do-not-touch

None — no vendored or generated directories in this package.

## Docs

- [README.md](README.md) — pipeline diagram, public API list.
- [docs/agent-prompts/README.md](../docs/agent-prompts/README.md) — canonical
  spec for anything touching `prompt.ts` or `grounding.ts`.
- [INSIGHTS.md](INSIGHTS.md) — the "why" behind the decisions above.

**Before ending a session:** update INSIGHTS.md with anything non-obvious
you learned — don't skip this step (`engineering-insights` skill).
