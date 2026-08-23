# ADR 0002: Model-owned scope filtering (not post-hoc finding filter)

- **Status:** Accepted
- **Date:** 2026-08-06
- **Context:** Intent Layer — how derived scope affects review findings

## Context

Once a PR has `in_scope[]` / `out_of_scope[]`, the product wants out-of-scope
noise de-prioritised while still allowing a serious out-of-scope defect to
surface. Two approaches were available:

1. Instruct the reviewer model via system prompt (`SCOPE_GUIDANCE`).
2. After `groundFindings`, deterministically drop or downgrade findings by
   matching each finding's `file` / `title` against free-text scope strings.

## Decision

Use **prompt-level, model-owned** guidance only. Append `SCOPE_GUIDANCE` to the
system message (after `INJECTION_GUARD`) **only when** `PromptParts.intent` is
present. Do **not** add a post-hoc scope filter on `Review.findings[]`.

Leave `groundFindings()` as a deterministic **citation** gate — it does not
decide scope.

## Rationale

- Fuzzy-matching prose scope bullets against paths/titles is an untested
  heuristic whose failure mode is **silently dropping a real `CRITICAL`** —
  exactly the outcome the acceptance criteria forbid.
- The prompt vocabulary already owns severity/verdict judgment
  (`CRITICAL | WARNING | SUGGESTION`); scope prioritisation belongs there,
  matching `docs/agent-prompts/README.md`.
- `INJECTION_GUARD` already names derived intent/scope as untrusted data;
  `SCOPE_GUIDANCE` reinforces that the block never descopes the review, then
  states the "at most one out-of-scope `CRITICAL`" rule in schema vocabulary
  with no finding-count quota.

Trade-off accepted explicitly: the constraint is soft and non-deterministic.
Tests assert the **prompt contains** the guidance and intent block (and that
both are absent when no intent exists) — never that a live model obeyed it.

## Consequences

- `reviewer-core/src/prompt.ts` owns `SCOPE_GUIDANCE` and the
  `## Derived intent & scope` user section.
- Server only supplies a pre-rendered plain-text `intent` string
  (`renderIntentBlock`); reviewer-core stays free of the `Intent` contract.
- No-intent runs remain byte-identical to pre-feature prompts (section and
  guidance both omitted).

## Alternatives considered

1. **Post-hoc filter on findings** — rejected for silent-drop risk on
   `CRITICAL`.
2. **Hard drop all out-of-scope findings** — conflicts with "never suppress a
   genuine CRITICAL because it is out of scope."
3. **Extend grounding to encode scope** — would conflate citation validity
   with product judgment; grounding stays citation-only.
