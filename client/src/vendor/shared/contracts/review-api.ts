import { z } from 'zod';
import { Finding, Verdict } from './findings.js';
import { BlastRadius, Brief, Intent, RiskSeverity, SmartDiff } from './brief.js';

/**
 * A2 — Review-Core API surface contracts. These extend the core
 * Review/Finding/Intent/SmartDiff contracts with the persisted/transport shapes
 * the reviewer endpoints return. A2 owns this file; the barrel re-exports it.
 *
 * Distinct from `Finding` (the raw LLM-output unit): `FindingRecord` adds the
 * persisted row identity + action timestamps so the UI can render accept/dismiss
 * state and the `review_id` it belongs to.
 */

export const FindingRecord = Finding.extend({
  review_id: z.string(),
  accepted_at: z.string().nullable(),
  dismissed_at: z.string().nullable(),
});
export type FindingRecord = z.infer<typeof FindingRecord>;

/** A persisted review with its kept findings + grounding summary. */
export const ReviewRecord = z.object({
  id: z.string(),
  pr_id: z.string(),
  agent_id: z.string().nullable(),
  run_id: z.string().nullable(),
  agent_name: z.string().nullish(),
  kind: z.enum(['summary', 'review']),
  verdict: Verdict.nullable(),
  summary: z.string().nullable(),
  score: z.number().int().nullable(),
  model: z.string().nullable(),
  grounding: z.string().nullish(),
  created_at: z.string(),
  findings: z.array(FindingRecord),
});
export type ReviewRecord = z.infer<typeof ReviewRecord>;

/**
 * Response of `POST /pulls/:id/review`. Each requested agent produces a run that
 * streams over SSE at `/runs/:runId/events`; clients subscribe per run. The
 * persisted reviews are also returned once the (synchronous) run completes.
 */
export const ReviewRunTarget = z.object({
  run_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
});
export type ReviewRunTarget = z.infer<typeof ReviewRunTarget>;

export const ReviewRunResponse = z.object({
  pr_id: z.string(),
  runs: z.array(ReviewRunTarget),
  reviews: z.array(ReviewRecord),
});
export type ReviewRunResponse = z.infer<typeof ReviewRunResponse>;

/**
 * Intent persisted for a PR (the Intent plus the pr_id it scopes and the
 * classification metadata the card/trace need: which commit it describes
 * — compared against `pull.head_sha` client-side to render the "stale, re-run?"
 * state — which provider/model classified it, and when).
 */
export const PrIntentRecord = Intent.extend({
  pr_id: z.string(),
  head_sha: z.string().nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  classified_at: z.string(),
});
export type PrIntentRecord = z.infer<typeof PrIntentRecord>;

/** Smart-diff response for a PR (the SmartDiff). */
export const SmartDiffResponse = SmartDiff;
export type SmartDiffResponse = z.infer<typeof SmartDiffResponse>;

/**
 * One prior PR (same workspace + repo) that overlaps ≥1 of the current PR's
 * changed file paths (WI3/WI4, L04 follow-ups — "Prior PRs touching these
 * files").
 */
export const PriorPr = z.object({
  id: z.string(),
  number: z.number().int(),
  title: z.string(),
  author: z.string(),
  overlapping_files: z.number().int(),
});
export type PriorPr = z.infer<typeof PriorPr>;

/**
 * Blast-radius response for a PR (`GET /pulls/:id/blast`, WI2). Extends the
 * core `BlastRadius` (`changed_symbols` / `downstream` / `summary`) with the
 * index-freshness status the endpoint derives from `IndexState` +
 * `BlastResult.degraded` — never a bare enum, `reason` is a human sentence
 * (null only when `status === 'full'`). `prior_prs` (WI4, L04 follow-ups) is
 * required, not optional: the service always produces it (`[]` on the
 * degraded/no-files path), so there is no "not yet computed" state to model.
 */
export const BlastRadiusResponse = BlastRadius.extend({
  status: z.enum(['full', 'partial', 'degraded']),
  reason: z.string().nullable(),
  prior_prs: z.array(PriorPr),
});
export type BlastRadiusResponse = z.infer<typeof BlastRadiusResponse>;

// ---- SPEC-03: PR Brief & Why Timeline ----

/**
 * What a generation's inputs actually looked like — provenance for the card's
 * collapsed "Inputs" disclosure (UX-12) and the Q-4 grounding-drop line.
 * `intent_status`/`linked_issue_status` mirror AC-6/E-3 and AC-4's degrade-
 * not-classify rule: a brief composed with no intent or no issue must say so
 * rather than reading as merely terse. `dropped_inputs[]` is AC-24/AC-26's
 * whole-item budget-trim log (e.g. "spec file docs/x.md dropped (sub-cap)",
 * "linked issue dropped (budget)") — distinct from `BriefUsage`'s
 * `dropped_risk_refs`/`dropped_focus_items`, which count AC-18/AC-19
 * grounding drops of the model's *output*, not budget drops of the *input*.
 */
export const BriefInputStatus = z.object({
  intent_status: z.enum(['used', 'missing', 'stale']),
  blast_status: z.enum(['full', 'partial', 'degraded']),
  changed_file_count: z.number().int(),
  spec_files_used: z.array(z.string()),
  spec_files_unresolved: z.array(z.string()),
  linked_issue_status: z.enum(['used', 'unresolved', 'not_referenced']),
  dropped_inputs: z.array(z.string()),
});
export type BriefInputStatus = z.infer<typeof BriefInputStatus>;

/**
 * Generation usage/cost (AC-10) plus the AC-18/AC-19 grounding-drop counts
 * (AC-22) — how many `risks[].file_refs`/`review_focus[]` entries were
 * discarded after the call because they didn't cite a real changed file/line.
 * `tokens_in`/`tokens_out`/`cost_usd` are nullable (E-20, same contract as
 * `OnboardingGenerationUsage`) — a provider that doesn't report cost must not
 * be rendered as free. `input_tokens` is always present: it's the pre-call
 * measurement this module made itself (AC-23), not something the provider
 * returns.
 */
export const BriefUsage = z.object({
  provider: z.string(),
  model: z.string(),
  input_tokens: z.number().int(),
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  dropped_risk_refs: z.number().int(),
  dropped_focus_items: z.number().int(),
});
export type BriefUsage = z.infer<typeof BriefUsage>;

/** The `Brief` plus everything needed to render/audit it: which commit it
 *  describes, what its inputs looked like, and what generating it cost. */
export const BriefRecord = Brief.extend({
  pr_id: z.string(),
  head_sha: z.string(),
  generated_at: z.string(),
  input_status: BriefInputStatus,
  usage: BriefUsage,
});
export type BriefRecord = z.infer<typeof BriefRecord>;

/**
 * `BriefState` is deliberately split into persisted and transient values.
 * `'current' | 'stale' | 'absent' | 'corrupt'` are READ states — derivable
 * from storage alone, returned by `GET /pulls/:id/brief`. `'budget_exceeded'
 * | 'failed'` are TRANSIENT GENERATE-ONLY outcomes, returned only by
 * `POST …/generate` with `record: null`, and are never persisted: AC-25
 * requires the floor-exceeded case to make zero calls, and AC-42 requires a
 * failed attempt to persist nothing and leave any prior row untouched — so by
 * construction there is no row to read either state back from later. Mirrors
 * `OnboardingTourResponse.status`, which likewise carries `llm_failed` as a
 * response state rather than throwing (`onboarding/service.ts:202-222`).
 */
export const BriefState = z.enum(['current', 'stale', 'absent', 'corrupt', 'budget_exceeded', 'failed']);
export type BriefState = z.infer<typeof BriefState>;

/** `GET /pulls/:id/brief` and `POST /pulls/:id/brief/generate` share this
 *  response shape (AC-11, the `IntentService.getOrClassify` `{record,
 *  reused}` precedent). `reason` carries the human explanation for a
 *  non-`current` state (stale-since-commit, corrupt-row, budget-exceeded,
 *  failed-attempt) — `null` only when `state === 'current'`. */
export const BriefResponse = z.object({
  state: BriefState,
  current_head_sha: z.string(),
  record: BriefRecord.nullable(),
  reused: z.boolean(),
  reason: z.string().nullable(),
});
export type BriefResponse = z.infer<typeof BriefResponse>;

/** One row of the Why Timeline (D-3 — "Why Timeline" is the product name;
 *  the identifier is `BriefTimeline*`, never `Why*`, which already means
 *  git-blame). `record` carries the FULL persisted `BriefRecord` (the
 *  "two endpoints, not three" decision) so activating a historical entry
 *  costs zero additional requests. `risk_changed` compares this entry's
 *  `risk_level` to the next-older entry's (AC-33). */
export const BriefTimelineEntry = z.object({
  head_sha: z.string(),
  generated_at: z.string(),
  risk_level: RiskSeverity,
  is_current_head: z.boolean(),
  risk_changed: z.boolean(),
  record: BriefRecord,
});
export type BriefTimelineEntry = z.infer<typeof BriefTimelineEntry>;

/** `GET /pulls/:id/brief/timeline`. `brief_count`/`commit_count` back the
 *  AC-34/UX-8 honest-gap disclosure ("3 briefs generated across 12
 *  commits") — the timeline never implies it covers every commit. */
export const BriefTimelineResponse = z.object({
  entries: z.array(BriefTimelineEntry),
  brief_count: z.number().int(),
  commit_count: z.number().int(),
});
export type BriefTimelineResponse = z.infer<typeof BriefTimelineResponse>;
