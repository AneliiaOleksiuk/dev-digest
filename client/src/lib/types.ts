/**
 * Shared contract types re-exported from @devdigest/shared (single source of
 * truth). F2 imports these rather than redefining them.
 *
 * F1 (@devdigest/shared) currently exports all the platform/findings/brief/
 * knowledge/trace contracts we need for the scaffolding screens, so there are
 * NO local placeholders required at this time. If a feature agent's contract is
 * not yet exported, add a placeholder below marked
 * `// TODO: reconcile with @devdigest/shared`.
 */
export type {
  Settings,
  SettingsUpdate,
  ConnTestProvider,
  ConnTestResult,
  SecretsStatus,
  FeatureModelId,
  FeatureModelChoice,
  FeatureModelDef,
  Provider,
  ModelInfo,
  Repo,
  RepoInput,
  PrMeta,
  PrDetail,
  PrFile,
  PrCommit,
  PrReviewComment,
  PrStatus,
  ContextDocument,
  ContextListing,
  ContextAttachment,
  OtherRepoAttachment,
  ContextAttachmentSet,
  SetContextBody,
  ContextDocumentContent,
  SaveContextDocumentBody,
  CreateContextDocumentBody,
  ContextWriteResult,
  IndexStatus,
  Onboarding,
  OnboardingSection,
  OnboardingLink,
  OnboardingTask,
  OnboardingSectionKind,
  OnboardingStatus,
  OnboardingGenerationUsage,
  OnboardingTourResponse,
} from "@devdigest/shared";
export { ONBOARDING_SECTION_KINDS } from "@devdigest/shared";

export type { Review, Finding, Severity, Verdict } from "@devdigest/shared";
export type { PrBrief, SmartDiff } from "@devdigest/shared";

export type {
  Brief,
  ReviewFocusItem,
  Risk,
  RiskSeverity,
  BriefInputStatus,
  BriefUsage,
  BriefRecord,
  BriefState,
  BriefResponse,
  BriefTimelineEntry,
  BriefTimelineResponse,
} from "@devdigest/shared";

/* Eval Pipeline (L06, docs/plans/eval-pipeline.md WI9) — the eval-ci
   contract types, re-exported per this file's own header convention
   (add here rather than redefine locally). `hooks/eval.ts` imports from
   "../types" the same way `hooks/brief.ts` imports BriefResponse. */
export type {
  EvalExpectationEntry,
  EvalExpectation,
  EvalCaseInputMeta,
  EvalCaseInput,
  EvalCaseFromFindingInput,
  EvalCaseRecord,
  EvalRunRecord,
  EvalBatchRecord,
  EvalComparison,
  EvalTrendPoint,
  EvalDashboard,
} from "@devdigest/shared";

/** What a findings-deep-link click should focus: a run, a severity, a
 *  single finding, or any combination — driven from the PR list hover
 *  preview, the Timeline, a Review-runs header badge, or a diff-line tag. */
export interface FocusFindingsOptions {
  runId?: string | null;
  severity?: string | null;
  findingId?: string | null;
}

/** What a review-focus deep-link click should land on in the Files-changed
 *  tab: a specific `path:line` (SPEC-03 AC-30). Distinct from
 *  `FocusFindingsOptions` — this one drives the diff-viewer's expand+scroll,
 *  not the Findings tab's run/severity filter. */
export interface FocusDiffLineOptions {
  path: string;
  line: number;
}
