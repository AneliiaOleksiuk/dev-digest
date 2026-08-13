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
} from "@devdigest/shared";

export type { Review, Finding, Severity, Verdict } from "@devdigest/shared";
export type { PrBrief, SmartDiff } from "@devdigest/shared";

/** What a findings-deep-link click should focus: a run, a severity, a
 *  single finding, or any combination — driven from the PR list hover
 *  preview, the Timeline, a Review-runs header badge, or a diff-line tag. */
export interface FocusFindingsOptions {
  runId?: string | null;
  severity?: string | null;
  findingId?: string | null;
}
