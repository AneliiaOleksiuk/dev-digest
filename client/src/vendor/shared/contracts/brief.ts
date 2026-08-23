import { z } from 'zod';

/**
 * PR Brief building blocks: Intent, Blast radius, Risks, PR History,
 * Smart Diff. Composed into PrBrief.
 */

// ---- Intent ----
/**
 * Provenance for one piece of input the classifier used (or tried to use).
 * `resolved` is SERVER-computed, never model-authored: the classifier's own
 * structured-output schema (service-local, see `intent-service.ts`) has no
 * `sources` field at all — the server merges its own deterministic `sources[]`
 * on top of the model's output after the call returns.
 */
export const IntentSource = z.object({
  kind: z.enum([
    'pr_title',
    'pr_description',
    'linked_issue',
    'spec_file',
    'external_link',
    'changed_files',
  ]),
  ref: z.string().nullish(),
  resolved: z.boolean(),
});
export type IntentSource = z.infer<typeof IntentSource>;

/**
 * Product `summary` ≡ contract `intent` (kept as-is, not renamed — see
 * `docs/plans/intent-layer.md` §A.1 for why); product `in_scope[]`/
 * `out_of_scope[]` ≡ same names here.
 *
 * `confidence`/`sources`/`missing_context`/`risk_areas` are optional with
 * defaults so every existing parse site (incl. `PrBrief`, `PrIntentRecord`)
 * keeps working unchanged. `confidence` is capped server-side, never trusted
 * as-is from the model when any `sources[]` entry is unresolved — see
 * `capConfidence` in `server/src/modules/reviews/intent-inputs.ts`.
 *
 * Product "Risk Areas" (mock: short bullets like "New dependency: ioredis",
 * "Auth surface touched") ≡ `risk_areas[]` here — short classifier-authored
 * strings scoped to a single PR's intent. Distinct from the separate `Risks`
 * contract below (`Risk` objects with `severity`/`file_refs`, unbuilt PR
 * Brief scaffolding) — do not conflate the two.
 */
export const Intent = z.object({
  intent: z.string(),
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
  confidence: z.number().min(0).max(1).nullish(),
  sources: z.array(IntentSource).default([]),
  missing_context: z.array(z.string()).default([]),
  risk_areas: z.array(z.string()).default([]),
});
export type Intent = z.infer<typeof Intent>;

// ---- Blast radius ----
export const ChangedSymbol = z.object({
  name: z.string(),
  file: z.string(),
  kind: z.string(),
});
export type ChangedSymbol = z.infer<typeof ChangedSymbol>;

export const BlastCaller = z.object({
  name: z.string(),
  file: z.string(),
  line: z.number().int(),
});
export type BlastCaller = z.infer<typeof BlastCaller>;

export const DownstreamImpact = z.object({
  symbol: z.string(),
  callers: z.array(BlastCaller),
  endpoints_affected: z.array(z.string()),
  crons_affected: z.array(z.string()),
});
export type DownstreamImpact = z.infer<typeof DownstreamImpact>;

export const BlastRadius = z.object({
  changed_symbols: z.array(ChangedSymbol),
  downstream: z.array(DownstreamImpact),
  summary: z.string(),
});
export type BlastRadius = z.infer<typeof BlastRadius>;

// ---- Risks ----
export const RiskSeverity = z.enum(['high', 'medium', 'low']);
export type RiskSeverity = z.infer<typeof RiskSeverity>;

export const Risk = z.object({
  kind: z.string(),
  title: z.string(),
  explanation: z.string(),
  severity: RiskSeverity,
  file_refs: z.array(z.string()),
});
export type Risk = z.infer<typeof Risk>;

export const Risks = z.object({
  risks: z.array(Risk),
});
export type Risks = z.infer<typeof Risks>;

// ---- PR History ----
export const PrHistoryItem = z.object({
  pr_number: z.number().int(),
  title: z.string(),
  merged_at: z.string(),
  author: z.string(),
  files_overlap: z.array(z.string()),
  notes: z.string(),
});
export type PrHistoryItem = z.infer<typeof PrHistoryItem>;

export const PrHistory = z.object({
  history: z.array(PrHistoryItem),
});
export type PrHistory = z.infer<typeof PrHistory>;

// ---- Smart Diff ----
export const SmartDiffRole = z.enum(['core', 'wiring', 'boilerplate']);
export type SmartDiffRole = z.infer<typeof SmartDiffRole>;

export const SmartDiffFile = z.object({
  path: z.string(),
  pseudocode_summary: z.string().nullish(),
  additions: z.number().int(),
  deletions: z.number().int(),
  finding_lines: z.array(z.number().int()),
});
export type SmartDiffFile = z.infer<typeof SmartDiffFile>;

export const SmartDiffGroup = z.object({
  role: SmartDiffRole,
  files: z.array(SmartDiffFile),
});
export type SmartDiffGroup = z.infer<typeof SmartDiffGroup>;

export const ProposedSplit = z.object({
  name: z.string(),
  files: z.array(z.string()),
});
export type ProposedSplit = z.infer<typeof ProposedSplit>;

export const SmartDiff = z.object({
  groups: z.array(SmartDiffGroup),
  split_suggestion: z.object({
    too_big: z.boolean(),
    total_lines: z.number().int(),
    proposed_splits: z.array(ProposedSplit),
  }),
});
export type SmartDiff = z.infer<typeof SmartDiff>;

// ---- Composed PR Brief (pr_brief.json) ----
export const PrBrief = z.object({
  intent: Intent,
  blast: BlastRadius,
  risks: Risks,
  history: PrHistory,
});
export type PrBrief = z.infer<typeof PrBrief>;

// ---- SPEC-03: PR Brief & Why Timeline ----
/**
 * One review-focus entry: a model-cited `path:line` plus a one-line reason a
 * reviewer should look there. Distinct from `Risk.file_refs` (`string[]`,
 * no line, no reason) — this is why `review_focus[]` needed a new shape
 * rather than reusing `Risk` (D-1, SPEC-03). `path`/`line` are re-verified
 * against the PR's real changed-file set and hunk ranges in code before
 * persistence (AC-18–AC-20) — never trusted as-is from the model.
 */
export const ReviewFocusItem = z.object({
  path: z.string(),
  line: z.number().int(),
  reason: z.string(),
});
export type ReviewFocusItem = z.infer<typeof ReviewFocusItem>;

/**
 * The server-composed judgement produced by exactly one structured LLM call
 * per (PR, head_sha) — SPEC-03. Reuses `Risk`/`RiskSeverity` unchanged (D-1):
 * they already have the shape the product needs. Distinct from `PrBrief`
 * above, which is dead scaffolding (D-1) — `Brief` is a composed judgement
 * *over* intent/blast, never a container re-embedding copies of them.
 */
export const Brief = z.object({
  what: z.string(),
  why: z.string(),
  risk_level: RiskSeverity,
  risks: z.array(Risk),
  review_focus: z.array(ReviewFocusItem),
});
export type Brief = z.infer<typeof Brief>;
