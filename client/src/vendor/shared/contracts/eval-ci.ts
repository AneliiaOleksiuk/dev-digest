import { z } from 'zod';
import { Verdict, Finding } from './findings.js';
import { EvalRun, EvalOwnerKind, Conformance, Provider, CiFailOn } from './knowledge.js';

/**
 * A4 — Eval / CI / Compose / Conformance API contracts (L06).
 *
 * These EXTEND the barrel; they do not modify existing contract files. The base
 * `EvalRun`, `EvalCase`, `EvalOwnerKind`, `Conformance` live in `knowledge.ts`;
 * here we add the *API-facing* request/response shapes (records persisted in
 * `eval_runs`, `composed_reviews`, `ci_installations`, `ci_runs`,
 * `conformance_checks`) plus the eval-dashboard aggregate.
 */

// ===========================================================================
// Eval — case input + persisted run record + dashboard
// ===========================================================================

/**
 * One expected finding (or non-finding) an eval case asserts against.
 * Only `file` + the line range (`start_line`/`end_line`) + `match_scope`
 * participate in scoring/matching (see the eval module's `scorer.ts`,
 * `matchesExpectation`) — `severity`/`category`/`title`/`source_finding_id`
 * are display/provenance only and never affect a pass/fail verdict.
 */
export const EvalExpectationEntry = z.object({
  file: z.string().min(1),
  start_line: z.number().int().min(0),
  end_line: z.number().int().min(0),
  /**
   * 'file' skips the line-range check entirely — the shape reviewer-core
   * grounding already exempts (`secret_leak`, `lethal_trifecta`, `phantom`,
   * `hook` finding kinds; see `reviewer-core/src/grounding.ts`). Derived
   * server-side from the source finding's `kind` at case-creation time
   * (Q-6); defaults to 'range' for a hand-authored case.
   */
  match_scope: z.enum(['range', 'file']).default('range'),
  severity: z.string().nullish(),
  category: z.string().nullish(),
  title: z.string().nullish(),
  source_finding_id: z.string().nullish(),
});
export type EvalExpectationEntry = z.infer<typeof EvalExpectationEntry>;

/**
 * The full expectation stored on an eval case (`eval_cases.expected_output`).
 * `version` is a discriminator so a future shape change can degrade an old
 * row honestly — read back as `expectation_status: 'unusable'` with
 * `expected_output: null` (see `EvalCaseRecord`) — instead of throwing.
 */
export const EvalExpectation = z.object({
  version: z.literal(1),
  must_find: z.array(EvalExpectationEntry).default([]),
  must_not_flag: z.array(EvalExpectationEntry).default([]),
});
export type EvalExpectation = z.infer<typeof EvalExpectation>;

/**
 * Metadata pinned alongside `input_diff` on a create-from-finding case — the
 * source PR's title/body (WI5). Typed (not `z.unknown()`) because WI7's batch
 * runner reads `input_meta.body` straight into a prompt (Phase C) — an
 * unvalidated shape reaching an LLM call is a stored-content risk, the same
 * reasoning `expected_output` already got AC-11's schema for.
 */
export const EvalCaseInputMeta = z.object({
  title: z.string(),
  body: z.string(),
});
export type EvalCaseInputMeta = z.infer<typeof EvalCaseInputMeta>;

/** Create/update payload for an eval case (id + owner resolved by the route). */
export const EvalCaseInput = z.object({
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string().min(1),
  input_diff: z.string().default(''),
  input_files: z.array(z.string()).nullish(),
  input_meta: EvalCaseInputMeta.nullish(),
  expected_output: EvalExpectation,
  notes: z.string().nullish(),
});
export type EvalCaseInput = z.infer<typeof EvalCaseInput>;

/**
 * Body for `POST /findings/:id/eval-case` — the finding id travels as a
 * route param, never a body field, so it isn't part of this schema. Every
 * other field (expectation kind, `match_scope`, pinned diff, owner) is
 * derived server-side from the finding/review/PR (AC-3, D-7).
 */
export const EvalCaseFromFindingInput = z.object({
  name: z.string().min(1).nullish(),
});
export type EvalCaseFromFindingInput = z.infer<typeof EvalCaseFromFindingInput>;

/**
 * A persisted eval case, as returned by the API (read shape). A row whose
 * stored `expected_output` JSON fails to re-parse against `EvalExpectation`
 * reads back as `expectation_status: 'unusable'` + `expected_output: null`
 * rather than throwing (AC-13, E-12).
 */
export const EvalCaseRecord = z.object({
  id: z.string(),
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string(),
  input_diff: z.string(),
  input_files: z.array(z.string()).nullish(),
  input_meta: EvalCaseInputMeta.nullish(),
  /**
   * Read-side degradation for `input_meta`/`input_files`, same "degrade
   * rather than throw" pattern `expectation_status` established (AC-13,
   * E-12) — kept as its OWN field rather than folded into
   * `expectation_status` because the two are orthogonal: a case can have a
   * perfectly scoreable `expected_output` (`expectation_status: 'ok'`) with
   * corrupt/legacy `input_meta`, or vice versa. Conflating them would make a
   * metadata-only corruption falsely read as "this case can't be scored".
   */
  input_status: z.enum(['ok', 'unusable']).default('ok'),
  expected_output: EvalExpectation.nullable(),
  expectation_status: z.enum(['ok', 'unusable']),
  notes: z.string().nullish(),
});
export type EvalCaseRecord = z.infer<typeof EvalCaseRecord>;

/** A persisted eval run row (one execution of a case), returned by the API. */
export const EvalRunRecord = z.object({
  id: z.string(),
  case_id: z.string(),
  case_name: z.string().nullish(),
  /** The batch this run belongs to, if any (nullable — `ON DELETE SET NULL`). */
  batch_id: z.string().nullable(),
  ran_at: z.string(),
  actual_output: z.unknown(),
  pass: z.boolean().nullable(),
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  findings_total: z.number().int().nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  error: z.string().nullish(),
});
export type EvalRunRecord = z.infer<typeof EvalRunRecord>;

/** Result of running a single case: the metrics (EvalRun) + the persisted row id. */
export const EvalRunResult = z.object({
  run_id: z.string(),
  case_id: z.string(),
  result: EvalRun,
});
export type EvalRunResult = z.infer<typeof EvalRunResult>;

/**
 * A persisted eval batch — one version-pinned run of an owner's whole case
 * set (`eval_batches` row). `agent_version`/`provider`/`model`/
 * `skills_fingerprint` are pinned at batch start so a mid-batch config
 * change can't affect the running batch (AC-15, AC-16). `skills_fingerprint`
 * (the ordered `{skill_id, version}` list of the agent's enabled linked
 * skills at batch start) makes a skill-only edit visible on the batch even
 * though it does not bump `agents.version` (Q-3) — it does not change
 * `isConfigChange`/`agents.version` behaviour itself.
 */
export const EvalBatchRecord = z.object({
  id: z.string(),
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  agent_version: z.number().int(),
  provider: z.string(),
  model: z.string(),
  // Tolerate both a missing key and an explicit `null` (a genuinely NULL DB
  // column reads back as null, which `.default([])` does NOT catch) —
  // normalize both to an empty array, same pattern as `AgentManifest.skills`
  // below.
  skills_fingerprint: z
    .array(z.object({ skill_id: z.string(), version: z.number().int() }))
    .nullish()
    .transform((v) => v ?? []),
  ran_at: z.string(),
  status: z.enum(['completed', 'failed']),
  cases_total: z.number().int(),
  cases_passed: z.number().int(),
  cases_failed: z.number().int(),
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  /** Contributing case count per metric (AC-30) — a batch mean is over
   *  non-null per-case values only, so this can be less than cases_total. */
  recall_cases: z.number().int(),
  precision_cases: z.number().int(),
  citation_cases: z.number().int(),
  findings_total: z.number().int().nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  error: z.string().nullish(),
});
export type EvalBatchRecord = z.infer<typeof EvalBatchRecord>;

/**
 * Two batches side by side, for the read-only compare view (D-8, Q-2 — no
 * promote/revert). A null prompt means the `agent_versions` snapshot for
 * that batch's `agent_version` is missing — never falls back to the
 * agent's CURRENT prompt (AC-32).
 */
export const EvalComparison = z.object({
  base: EvalBatchRecord,
  head: EvalBatchRecord,
  delta: z.object({
    recall: z.number().nullable(),
    precision: z.number().nullable(),
    citation_accuracy: z.number().nullable(),
    cost_usd: z.number().nullable(),
  }),
  base_prompt: z.string().nullable(),
  head_prompt: z.string().nullable(),
});
export type EvalComparison = z.infer<typeof EvalComparison>;

/** One point on the dashboard trend — one per BATCH, not per run/case. */
export const EvalTrendPoint = z.object({
  batch_id: z.string(),
  agent_version: z.number().int(),
  ran_at: z.string(),
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  pass_rate: z.number(),
  cost_usd: z.number().nullable(),
});
export type EvalTrendPoint = z.infer<typeof EvalTrendPoint>;

/** Aggregate dashboard for an owner (agent/skill) or the whole workspace. */
export const EvalDashboard = z.object({
  owner_kind: EvalOwnerKind.nullable(),
  owner_id: z.string().nullable(),
  cases_total: z.number().int(),
  current: z.object({
    recall: z.number().nullable(),
    precision: z.number().nullable(),
    citation_accuracy: z.number().nullable(),
    traces_passed: z.number().int(),
    traces_total: z.number().int(),
    cost_usd: z.number().nullable(),
  }),
  /**
   * Null when the agent has fewer than two batches (E-17) — never a zero
   * delta. Each FIELD is also individually nullable (revised during Phase
   * C's plan-verifier fix-loop, docs/plans/eval-pipeline.md WI1/
   * Recommendation 1): once >=2 batches exist and a delta block IS rendered,
   * `latest`/`previous` can each still have their OWN metric be null (e.g. a
   * batch whose cases had zero must_find entries, so recall was never
   * measured that batch) — a per-field null means "unmeasured on at least
   * one side," mirroring EvalComparison.delta's existing honest pattern
   * rather than substituting a fabricated 0 baseline that would read as a
   * false swing (see modules/eval/service.ts's buildDashboard).
   */
  delta: z
    .object({
      recall: z.number().nullable(),
      precision: z.number().nullable(),
      citation_accuracy: z.number().nullable(),
    })
    .nullable(),
  trend: z.array(EvalTrendPoint),
  recent_runs: z.array(EvalBatchRecord),
  alert: z.string().nullable(),
});
export type EvalDashboard = z.infer<typeof EvalDashboard>;

// ===========================================================================
// Compose Review
// ===========================================================================

export const ComposeReviewInput = z.object({
  /** Finding ids to fold into the draft (optional — body may be hand-written). */
  finding_ids: z.array(z.string()).default([]),
  /** Editable markdown body. If omitted, the server composes one from findings. */
  body: z.string().nullish(),
  verdict: Verdict.default('comment'),
  /** When true, attach selected findings as inline comments (path+line+body). */
  inline_comments: z.boolean().default(false),
});
export type ComposeReviewInput = z.infer<typeof ComposeReviewInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type ComposeReviewInputBody = z.input<typeof ComposeReviewInput>;

/** A persisted composed review (mirrors the `composed_reviews` row). */
export const ComposedReview = z.object({
  id: z.string(),
  pr_id: z.string(),
  body: z.string(),
  verdict: Verdict.nullable(),
  posted_at: z.string().nullable(),
  github_review_id: z.string().nullable(),
});
export type ComposedReview = z.infer<typeof ComposedReview>;

/** A preview (no GitHub side-effect) of what would be posted. */
export const ComposeReviewPreview = z.object({
  body: z.string(),
  verdict: Verdict,
  inline_comments: z.array(
    z.object({ path: z.string(), line: z.number().int(), body: z.string() }),
  ),
});
export type ComposeReviewPreview = z.infer<typeof ComposeReviewPreview>;

// ===========================================================================
// Export-to-CI + CI Runs
// ===========================================================================

export const CiTarget = z.enum(['gha', 'circle', 'jenkins', 'cli']);
export type CiTarget = z.infer<typeof CiTarget>;

/** One generated file in the CI bundle (path + editable contents). */
export const CiFile = z.object({
  path: z.string(),
  contents: z.string(),
  editable: z.boolean().default(true),
});
export type CiFile = z.infer<typeof CiFile>;

/**
 * AgentManifest — the agent contract shared by the studio and the CI runner.
 *
 * The studio (`CiService.agentYaml`) WRITES this shape to
 * `.devdigest/agents/<slug>.yaml`; the agent-runner READS it. Keeping one Zod
 * schema for both ends guarantees the formats never drift. `skills` are slugs
 * resolved to `.devdigest/skills/<slug>.md`.
 */
export const AgentManifest = z.object({
  name: z.string().min(1),
  provider: Provider.default('openrouter'),
  model: z.string().min(1),
  system_prompt: z.string(),
  // Tolerate both a missing key and an explicit `null` (YAML `skills:` with no
  // value parses to null, which `.default([])` does NOT catch) — normalize both
  // to an empty array so manifests without skills validate cleanly.
  skills: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? []),
  strategy: z.enum(['auto', 'single-pass', 'map-reduce']).default('auto'),
  // CI gate policy (see CiFailOn) — when the posted review should BLOCK
  // (REQUEST_CHANGES + fail the check) vs just comment. Default: block on critical.
  ci_fail_on: CiFailOn.default('critical'),
});
export type AgentManifest = z.infer<typeof AgentManifest>;
/** Caller-facing input type — `.default()` fields stay optional. */
export type AgentManifestInput = z.input<typeof AgentManifest>;

/** Request body for `POST /agents/:id/export-ci`. */
export const CiExportInput = z.object({
  repo: z.string().min(1), // "owner/name"
  target: CiTarget.default('gha'),
  /** "open_pr" opens a PR with the files; "files" just returns/persists them. */
  action: z.enum(['open_pr', 'files']).default('open_pr'),
  post_as: z.enum(['github_review', 'pr_comment', 'none']).default('github_review'),
  triggers: z.array(z.string()).default(['opened', 'synchronize', 'reopened']),
  base: z.string().default('main'),
});
export type CiExportInput = z.infer<typeof CiExportInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type CiExportInputBody = z.input<typeof CiExportInput>;

/** A persisted CI installation (mirrors `ci_installations`). */
export const CiInstallation = z.object({
  id: z.string(),
  agent_id: z.string(),
  repo: z.string(),
  target_type: CiTarget,
  installed_at: z.string(),
});
export type CiInstallation = z.infer<typeof CiInstallation>;

/** Response of `POST /agents/:id/export-ci`. */
export const CiExport = z.object({
  installation: CiInstallation,
  files: z.array(CiFile),
  pr_url: z.string().nullable(),
});
export type CiExport = z.infer<typeof CiExport>;

export const CiRunStatus = z.enum(['succeeded', 'failed', 'no_findings', 'running']);
export type CiRunStatus = z.infer<typeof CiRunStatus>;

/** A CI run row (mirrors `ci_runs`) — ingested from GitHub Actions artifacts. */
export const CiRun = z.object({
  id: z.string(),
  ci_installation_id: z.string().nullable(),
  pr_number: z.number().int().nullable(),
  ran_at: z.string().nullable(),
  status: z.string().nullable(),
  findings_count: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  github_url: z.string().nullable(),
  source: z.string().nullable(),
  agent: z.string().nullish(),
  duration_s: z.number().nullish(),
});
export type CiRun = z.infer<typeof CiRun>;

/**
 * The artifact shape uploaded by the CI action (`devdigest-result.json`).
 * Ingested back on refresh to populate `ci_runs` (L06).
 */
export const CiResultArtifact = z.object({
  findings_count: z.number().int(),
  critical: z.number().int().nullish(),
  warning: z.number().int().nullish(),
  suggestion: z.number().int().nullish(),
  cost_usd: z.number().nullable(),
  duration_ms: z.number().int().nullish(),
  agent: z.string(),
  version: z.string().nullish(),
  pr_number: z.number().int().nullish(),
});
export type CiResultArtifact = z.infer<typeof CiResultArtifact>;

// ===========================================================================
// Conformance (PRD ↔ PR) — API record (the analysis shape is `Conformance`)
// ===========================================================================

/** Request body for `POST /pulls/:id/conformance`. */
export const ConformanceInput = z.object({
  /** Spec path/id to compare against; if omitted, the first available spec. */
  spec: z.string().nullish(),
  provider: z.enum(['openai', 'anthropic', 'openrouter']).nullish(),
  model: z.string().nullish(),
});
export type ConformanceInput = z.infer<typeof ConformanceInput>;

/** A persisted conformance check (mirrors `conformance_checks` + the report). */
export const ConformanceReport = z.object({
  id: z.string(),
  pr_id: z.string(),
  report: Conformance,
});
export type ConformanceReport = z.infer<typeof ConformanceReport>;

// ===========================================================================
// Hooks (Secret-Leak + Phantom-API detectors) — emit grounding-exempt findings
// ===========================================================================

export const HookKind = z.enum(['secret_leak', 'phantom']);
export type HookKind = z.infer<typeof HookKind>;

/** Result of running the built-in detectors over a PR. */
export const HookScanResult = z.object({
  pr_id: z.string(),
  review_id: z.string().nullable(),
  findings: z.array(Finding),
});
export type HookScanResult = z.infer<typeof HookScanResult>;
