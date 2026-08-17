# Workflow Retro: pr-brief-submission
Date: 2026-08-15
Mode: default
Scope: Submitting SPEC-03 (PR Brief & Why Timeline) as coursework —
verifying the already-built pipeline's artifacts against the assignment's
acceptance criteria, opening PR #8 (`L05-SDD-Brief-homework` → `L05-SDD`)
and fixing PR #7's CI, then diagnosing and fixing two live bugs (LLM
provider quota exhaustion, Why Timeline stale-time) found while exercising
the running app. Does NOT cover the actual SDD build pipeline
(spec-creator → implementation-planner → cross-model review → implementer
→ test-writer → plan-verifier → doc-writer) that produced SPEC-03 — that
ran in a prior session, before this conversation's `/clear`, and left no
telemetry behind (see Insights).

## Timeline

| # | Agent | Mode | Model | Tokens | Tool uses | Duration | Round-trips |
|---|---|---|---|---|---|---|---|
| 1 | general-purpose (SPEC-03 acceptance-criteria audit) | foreground | inherited (Sonnet 5) | 78,863 | 21 | 59,949 ms (~1.0 min) | 0 |

Everything else in this session — pushing branches, `gh pr create`/`gh pr
checks`/`gh run view`/`gh run rerun`, reading CI logs, editing two test
files, writing and deleting three throwaway diagnostic scripts, editing
`hooks/brief.ts` — was done via direct tool calls by the main agent, not
delegated to a subagent.

## Totals

Agents spawned: **1** · Total subagent tokens: **78,863** · Total tool uses
(subagent): **21** · Total round-trips: **0** · Subagent wall-clock:
**~1.0 min**. Overall session wall-clock: **not tracked — missing data,
not estimated.**

## Insights

- The one subagent spawned this session needed zero round-trips: a single
  foreground pass checked SPEC-03's 11 acceptance criteria plus the Why
  Timeline stretch goal and returned PASS on all 12 with file:line
  evidence, in 78,863 tokens / 21 tool uses / ~60s — the brief (12 numbered
  criteria, each with "what to check" and "where to look") was complete
  enough on the first try.
- Everything after the audit (PR creation, CI-log diagnosis, two live bug
  fixes) was direct tool use, not agent delegation — each step's output
  determined the next action in a tight loop (one CI log line decided the
  next grep; one curl response decided the next code edit), a shape that
  doesn't parallelize well across an agent boundary and would have added
  round-trip latency for no benefit.
- Two real defects — OpenAI/Anthropic API quota exhaustion, and
  `usePrBriefTimeline` inheriting the global 30s `staleTime` and refetching
  on every reopen past that window — were both invisible to the code-level
  verification audit and surfaced only once the running app was exercised
  live (a user screenshot, then direct API/browser reproduction). The
  audit's "PASS on all 11 criteria" was an accurate read of the code as
  written; it was never a claim that generation works with the specific
  API credentials in use, or that the client's caching *feels* correct at
  the UX level — both are runtime/config facts a source-level review can't
  see.
- Diagnosing "Generation failed" required a throwaway script
  (`server/scratch-diagnose-brief.ts`, deleted after use) that constructed
  `BriefService` directly and called `.generate()`, bypassing the HTTP
  layer — the route swallows the real error into a generic
  `{"state":"failed"}` response (`server/src/modules/brief/service.ts:214-229`),
  and the running dev server's pino logs go to a terminal not visible in
  this conversation. Same pattern was reused for `scratch-test-providers.ts`
  to confirm which of the three configured providers (OpenAI, Anthropic,
  OpenRouter) actually had usable quota.
- This retro's scope is hard-bounded by `/clear`: the actual multi-agent
  SDD pipeline that produced SPEC-03 (spec-creator, implementation-planner,
  a cross-model Grok review, implementer, test-writer, a plan-verifier
  fix-loop, doc-writer) is not observable from this conversation at all —
  only its already-committed artifacts (spec.md, plan.md, verification.md,
  the code, the docs) could be verified. No per-agent tokens, tool_uses, or
  round-trip counts survived the clear.

## Recommendations

- Before treating a `plan-verifier` "PASS" as demo-ready, run one live
  smoke pass through the actual running app with real provider keys — it
  would have caught both the quota exhaustion and the timeline
  stale-time bug during build, instead of during demo prep the day
  submission was due.
- Document the "bypass HTTP, construct the service class directly, call
  it from a throwaway `tsx` script, then delete the script" debug recipe
  in `server/INSIGHTS.md` for any route that swallows its real error into
  a generic failed-state response — this session re-derived
  `new BriefService(container.briefRepo, container.briefSources,
  container)` from `routes.ts` by hand; a one-line pointer would save
  that next time.
- A full-pipeline retro (spec-creator through plan-verifier, with real
  per-stage telemetry) for SPEC-03 is no longer producible — that data
  only exists within the session that ran the pipeline, before it hit
  `/clear`. If per-stage telemetry matters for a future SPEC, run
  `/workflow-retro` in the same session as the pipeline, before clearing.

Related prior retro: [2026-08-12-project-context-spec.md](2026-08-12-project-context-spec.md)
covers a different SDD stage (`spec-creator` alone, three turns) but is the
only other retro on record — its whole scope stayed inside one continuous
session, so this is the first observed case where a retro's scope was
actually cut short by a `/clear` boundary, not just a stage difference.
