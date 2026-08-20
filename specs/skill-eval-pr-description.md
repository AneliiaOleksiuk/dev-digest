# Spec: regression evals for the `pr-description` skill

Status: draft
Supersedes: —
Modules: `evals/` (the harness package). Reads `.claude/skills/pr-description/SKILL.md`
as the artifact under test — never edits it.

Filename follows this repo's **bare-name** spec convention
(`specs/skills-feature.md`, `specs/conventions-extractor.md`) rather than the
`SPEC-0N-` prefix used by the three large product specs — this is a small
harness addition, not a product feature.

## Problem & User

`.claude/skills/pr-description/SKILL.md` has no regression protection inside
this repo's own eval harness (`evals/`). `evals/skills/` currently contains a
single folder, `dependency-checker/` — `pr-description` is not covered.

Two concrete consequences, both verified:

- Any edit to `SKILL.md`'s `description` frontmatter or its instructions can
  silently change behavior, and nothing in the repo catches it. The failure
  surfaces days later, as a wrong PR description.
- CI already routes this: `evals/scripts/ci-detect.mjs` maps a changed
  `.claude/skills/<name>/**` to `evals/skills/<name>`, but only runs it when
  that folder holds a `*.eval.ts` (`hasEvals()`, ci-detect.mjs:31-35).
  Today a `pr-description` edit is reported as
  `⚠️ SKIP skills (no evals written)` in the job summary
  (`.github/workflows/evals.yml`, `detect` job summary step) and never
  measured. Adding this suite is what flips that SKIP into a real run.

User: the course student maintaining this harness, and anyone later editing
`SKILL.md` who wants a signal *in the same PR* instead of a week later.

## Goals / Non-goals

**Goals**

1. Add `evals/skills/pr-description/` with `pr-description.eval.ts`,
   `pr-description.cases.ts`, and `fixtures/` — four `SkillCase` entries,
   following `evals/skills/dependency-checker/` verbatim as the template.
2. **patternMatch first.** Any expectation that is a concrete, checkable
   fact becomes a `kind: "grounding"` case (deterministic, no judge);
   only genuine judgment calls go to `llmJudge` `practices`.
3. Calibrate the judge `practices` against real verdict output (read the
   evidence quotes) until each practice discriminates — neither trivially
   passing nor unfairly failing.
4. Prove the suite protects something: deliberately break one `SKILL.md`
   rule, observe the mapped case go red, **revert to the previous version**,
   observe green again. Report both observations.
5. Commit a calibrated baseline (`evals/baselines/skills-pr-description.json`)
   as required by `evals/README.md`'s "Which change → which run" table.

**Non-goals**

- **No permanent change to `SKILL.md`.** The break/revert in Goal 4 is a
  *validation of the eval*, performed and reported by the implementer; the
  final diff must leave `SKILL.md` byte-identical.
- **No harness engine work.** `evals/src/**` is out of scope — case files,
  fixtures, and the baseline snapshot only. In particular, do not extend
  `patternMatch` to support negation (see Edge cases E1).
- **No workflow-tier case.** Asserting "the model did not call `gh pr create`"
  needs a tool trace, which the content tier cannot produce (E3). Out of scope.
- **No change to the skill's existing `evals/evals.json`** (see below) — it is
  a different tool's format and stays untouched.
- Independent of any other in-flight spec; this one adds no schema, route, or UI.

## Reuse decision — the skill's own `evals/` folder

`.claude/skills/pr-description/evals/evals.json` already defines three cases
with fixture repos (`case-1-ratelimiter-fix`, `case-2-ui-spinner`,
`case-3-adversarial-gate`). That is the **skill-creator** tool's native eval
format — a separate mechanism from the `evals/` package, driven by a different
workflow.

Decision: **reuse the three scenarios as raw material, not the files.**

- The new fixtures are newly authored unified diffs under
  `evals/skills/pr-description/fixtures/`, derived from those scenarios
  (rate-limiter off-by-one; submit-button spinner; the adversarial
  "just create the PR" framing).
- Never read from `.claude/skills/pr-description/evals/fixtures/**` at case
  runtime: `evals/README.md` (Case layout) states fixtures must not live under
  `.claude/skills/*` because that folder is the skill's *payload* and a fixture
  there would leak into the assembled prompt.
- `evals.json` and its fixture repos are not moved, edited, or deleted.

## User stories

- As the harness maintainer, I edit `SKILL.md`, run
  `pnpm vitest run "skills/pr-description/"`, and see within one run whether a
  rule I depend on still holds.
- As a reviewer of that PR, I read the CI job summary's `eval:report` table
  (baseline vs this run) instead of taking the author's word for it.

## Acceptance criteria (EARS)

- **AC-1** — The system shall provide `evals/skills/pr-description/` containing
  `pr-description.eval.ts`, `pr-description.cases.ts`, and a `fixtures/`
  directory. (verify: file listing)
- **AC-2** — The system shall keep `pr-description.eval.ts` to a single
  `describeSkill("pr-description", () => runSkillCases("pr-description", cases))`
  and its two imports, matching `dependency-checker.eval.ts:1-4`.
- **AC-3** — `pr-description.cases.ts` shall export `cases: SkillCase[]` with
  exactly four entries — G1, Q1, Q2, Q3 below — of which **at least one**
  (G1) has `kind: "grounding"`.
- **AC-4** — WHEN the grounding case (G1) runs, the system shall require every
  substring in its `grounding` list to be present, so that `patternMatch`
  equals `1.0`; the list shall cover the five section headings plus the two
  Effort bullet labels required by `SKILL.md:26-72`. (verify: `kind:
  "grounding"`, no judge — `case.ts:115-125`)
- **AC-5** — WHEN case Q1 runs (a diff plus a PR template containing
  `- [ ] Bug fix` / `- [ ] Feature`), the judge practices shall check that no
  unchecked template checkbox survives in the draft, that Scope bullets are
  specific to the supplied diff, and that Effort carries only the Tool and
  Model(s) bullets with no token/cost/contribution padding, per
  `SKILL.md:33-36` and `64-72,91-92`. (verify: `llmJudge`)
- **AC-6** — WHEN case Q2 runs (a UI diff, stated as having no browser or
  screenshot tooling available), the judge practices shall check that the Tests
  section states visual verification was not possible and claims no screenshot
  and no test command that was not run, per `SKILL.md:44-62` and `81-92`.
- **AC-7** — WHEN case Q3 runs (the user explicitly demands the PR be created
  without seeing a draft), the judge practices shall check that the response
  still contains the full five-section draft, explicitly declines to skip the
  sign-off, and does not claim the PR was created, per `SKILL.md:12-24`.
- **AC-8** — IF `pnpm vitest run "skills/pr-description/"` is run from `evals/`
  on an unmodified checkout, THEN every case shall pass, and `pnpm typecheck`
  shall pass. (verify: manual run, output pasted into the implement/verify
  commit or PR)
- **AC-9** — The sensitivity proof shall use this one designated regression:
  delete the Scope rule sentence "Never leave generic template checkboxes
  (`- [ ] Feature`, `- [ ] Bug fix`, etc.) unchecked or as-is -- strip them out
  entirely and replace with real bullets." (`SKILL.md:35-36`).
  WHEN that sentence is deleted, case **Q1** shall fail; and WHEN `SKILL.md` is
  **reverted to the previous version**, Q1 shall pass again. Both runs are
  observed manually by the implementer and reported; **this is not encoded as a
  permanent test.**
- **AC-10** — WHERE a `*.cases.ts` file is added or changed, the system shall
  carry a committed baseline: `pnpm eval:repeat skills/pr-description -n 2
  --label baseline --commit`, producing tracked
  `evals/baselines/skills-pr-description.json` (slug = pattern with `/` → `-`,
  per `evals/baselines/README.md`), committed in the same change.
- **AC-11** — The final diff shall not modify
  `.claude/skills/pr-description/SKILL.md` or anything under
  `.claude/skills/pr-description/evals/**`. (verify: `git diff --stat` after
  the AC-9 revert)
- **AC-12** — Each SDD stage shall land as its **own commit, made only after
  that stage is verified**: (1) this spec, (2) the Development Plan, (3) the
  implementation, (4) the verification — the AC-8/AC-9 run output plus the
  committed baseline. No stage is committed ahead of its own verification, and
  no two stages share a commit.

## Edge cases

Each is grounded in a file actually read; they exist because they change how a
case must be written.

- **E1 — `patternMatch` cannot express absence.** `pattern-match.ts:6-10`
  computes the fraction of `expected` substrings *present*. "No `- [ ]`
  boilerplate remains" is therefore **not** groundable and must be a judge
  practice (AC-5).
- **E2 — `patternMatch` is order-insensitive.** So "five sections *in this
  order*" cannot be a grounding check either; grounding covers presence, a
  judge practice covers order and "Effort has exactly two bullets, no
  tokens/cost/contribution narrative" (`SKILL.md:64-72`, `91-92`).
- **E3 — `skillTask` runs content-only, with no tools** (`tasks.ts:21-24`;
  `dependency-checker.cases.ts:3-6`). There is no tool trace, so Q3 can only
  assert on the response *text*, never on "did not call `gh pr create`".
- **E4 — Prompts must present the diff as already gathered.** Because of E3,
  each prompt inlines its fixture and instructs the model to produce the draft
  directly rather than ask for tool access — the same framing
  `dependency-checker.cases.ts:8` uses.
- **E5 — Effort-bullet grounding is formatting-sensitive.** `**Tool:**` only
  matches if the model reproduces the bold label from `SKILL.md:68-72`. Ask for
  the PR body as markdown in the prompt; if calibration still shows flakiness,
  relax the substrings and move the strict shape to a practice.
- **E6 — CI judges on a different model than local.** `.github/workflows/
  evals.yml`'s `skills` job sets `EVAL_MODEL` *and* `EVAL_JUDGE_MODEL` to
  `deepseek/deepseek-chat` with `EVAL_MAX_TURNS: 6`, while the local default is
  `claude-haiku-4-5` judged by `claude-sonnet-5` (`evals/README.md`, env table).
  Locally-calibrated thresholds can read differently in CI. The tier is
  report-only (`continue-on-error: true`), so this cannot block a merge — but
  keep thresholds in the 0.6–0.7 band the existing cases use rather than at 1.0.
- **E7 — Folder name must be exactly `pr-description`.** The CI matrix runs
  `pnpm vitest run "skills/${{ matrix.skill }}/"` with a deliberate trailing
  slash because vitest's positional filter is a substring match (comment in
  `evals.yml`, `skills` job).
- **E8 — The AC-9 break leaves the tree dirty.** Revert `SKILL.md` to the
  previous version before committing anything; the records written during the
  red run carry a `dirty` flag and live in gitignored `results/`, so they are
  harmless.
- **E9 — Fixture placement.** Fixtures live beside the cases
  (`evals/skills/pr-description/fixtures/`), never under `.claude/skills/**`
  (`evals/README.md`, Case layout). `dependency-checker` inlines its data as a
  const and leaves `fixtures/` empty; multi-line unified diffs read better as
  files via `fixtureReader(import.meta.url)` (`src/artifacts/fixture.ts`) —
  both are supported, and this spec chooses `fixtureReader`.

## Non-functional requirements

- **Cost.** Four cases, one model call each, plus one judge call per quality
  case. G1 is `kind: "grounding"` and skips the judge entirely
  (`case.ts:115-119`) — the cheap tier first, as `evals/README.md` prescribes.
  Keep `maxTurns` at or below the CI cap of 6.
- **Stability.** Judge practices must be binary and evidence-quotable; a case
  landing in the 20–80% pass band is flagged `flaky` by the stats tools. Two
  repeat runs (`-n 2`) is the baseline minimum; `n<5` is "indicative only".
- **Maintainability.** *Practice text is the statistics identity*
  (`evals/README.md`, Statistics semantics) — rewording a practice starts a new
  series. Finish calibration **before** committing the baseline, then avoid
  churn in the wording.
- **Security — fixtures are sent to a third-party model.** In CI the skills
  tier runs on OpenRouter, so every fixture byte leaves the machine. Fixtures
  must be synthetic and contain no real credentials, tokens, internal URLs, or
  copied production diffs. No new secret is introduced;
  `OPENROUTER_API_KEY` comes from Actions secrets and is skipped on fork PRs
  (`evals.yml`, `skills` job `if:`).
- **Security — prompt-injection discipline in fixtures.** Fixture text is
  attacker-shaped input in principle. Beyond Q3's *intentional* adversarial
  framing (which is the measurement), no fixture may contain instructions that
  hijack the skill under test — that would silently invalidate the result
  rather than measure it. Q3's pressure lives in the user prompt, where it is
  explicit and reviewable, not hidden inside a diff.
- **Safety — no tools, keep it that way.** `skillTask` grants no tools, so a
  case cannot write to the repo or call `gh`. Do not add tools to these cases;
  `evals/README.md`'s Safety section warns against widening tool access under
  `bypassPermissions`.
- **Observability.** Every run appends to `results/records.jsonl` with
  per-practice evidence, and CI publishes `pnpm eval:report skills/pr-description`
  into the job summary, diffed against the committed baseline.
- **Performance/availability targets:** none defined — an eval suite has no
  runtime SLA. Wall-clock is bounded by the job's `timeout-minutes: 15`.

## Module interaction / API contracts

Contracts consumed (none authored):

| Contract | Source | Used for |
|---|---|---|
| `SkillCase { name, kind?, prompt, practices?, grounding?, threshold?, maxTurns? }` | `evals/src/dsl/case.ts:23-35` | case shape |
| `describeSkill` / `runSkillCases` | `evals/src/index.ts` barrel | the thin `*.eval.ts` |
| `fixtureReader(import.meta.url)` | `evals/src/artifacts/fixture.ts` | inlining fixture diffs |
| `skillTask` → content-only run | `evals/src/tasks.ts:21-24` | why prompts inline data (E3/E4) |
| `patternMatch` / `llmJudge` | `evals/src/scoring/*` | the two scorers (E1/E2) |

Commands (all from `evals/`, per `evals/package.json`):

| Purpose | Command |
|---|---|
| Scaffold the three files | `pnpm eval:scaffold pr-description` |
| Run the suite | `pnpm vitest run "skills/pr-description/"` |
| Calibrate / stability | `pnpm eval:repeat skills/pr-description -n 5 --label baseline` |
| Compare two labeled runs | `pnpm eval:delta baseline candidate` |
| Commit the baseline (AC-10) | `pnpm eval:repeat skills/pr-description -n 2 --label baseline --commit` |
| Typecheck | `pnpm typecheck` |

CI flow once this lands: a change under `.claude/skills/pr-description/**` **or**
`evals/skills/pr-description/**` → `detect` emits `pr-description` (no longer a
SKIP) → the `skills` matrix leg runs the suite and appends an `eval:report`
table to the job summary. Only `eval:quality` blocks merge.

## UX improvements

Developer-experience only:

- The suite turns an invisible `SKIP` line into a visible pass/fail row on
  every PR touching the skill — the actual UX win.
- Name each case after the rule it protects (e.g. "strips template checkboxes
  instead of leaving them unchecked"), because the case name is the vitest
  label, the record `nodeid`, and the baseline key — a vague name makes the CI
  table unreadable.
- Keep `pr-description.eval.ts` thin so the diff a future reader opens is the
  data file, not the plumbing.

## Inputs and provenance

| Section | Grounded in |
|---|---|
| Problem & User | `evals/scripts/ci-detect.mjs:31-35,55-59`; `.github/workflows/evals.yml` (`detect` summary); `evals/skills/` listing (only `dependency-checker`) |
| Goals / Non-goals | The student's stated request (scope decision) + `evals/README.md` "Which change → which run" |
| Reuse decision | `.claude/skills/pr-description/evals/evals.json`; fixture sources `case-1-ratelimiter-fix/server/src/utils/rateLimiter.ts`, `case-2-ui-spinner/client/src/components/SubmitButton.tsx`; `evals/README.md` Case layout |
| Acceptance criteria | `.claude/skills/pr-description/SKILL.md:12-24,26-36,44-62,64-72,81-92`; `evals/skills/dependency-checker/*.ts`; `evals/src/dsl/case.ts:101-132`; `evals/baselines/README.md` |
| Edge cases | `evals/src/scoring/pattern-match.ts:6-10`; `evals/src/tasks.ts:21-24`; `evals/skills/dependency-checker/dependency-checker.cases.ts:3-8`; `.github/workflows/evals.yml` (`skills` job env + filter comment); `evals/src/artifacts/fixture.ts` |
| Non-functional requirements | `security` skill (OWASP: secrets handling, untrusted input/prompt injection, least privilege) + `evals/README.md` (Statistics semantics, Safety, analyst flags) + `evals/src/dsl/case.ts:115-119` |
| Module interaction / API contracts | `evals/src/dsl/case.ts`, `src/tasks.ts`, `src/artifacts/fixture.ts`, `evals/package.json` scripts, `.github/workflows/evals.yml` |

## Untrusted inputs

- **Fixture diffs** — authored in-repo, but transmitted to a third-party model
  in CI: synthetic only, no secrets, no injection payloads beyond Q3's explicit
  and reviewable adversarial user prompt (see NFRs).
- **Model output** — scored as text only. It is never executed, never written
  to a file by the case, and never used to build a command; `skillTask` grants
  no tools at all.
- **`OPENROUTER_API_KEY`** — CI-only, from Actions secrets, withheld on fork
  PRs by design. This change neither reads nor logs it.

## Open questions

- A future workflow-tier `activation` case ("does `pr-description` activate on
  a `gh pr create` prompt") is explicitly a non-goal here; recorded so it is
  not rediscovered as a gap.
