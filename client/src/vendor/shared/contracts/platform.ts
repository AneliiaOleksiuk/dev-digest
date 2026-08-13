import { z } from 'zod';
import { Provider } from './knowledge.js';

/**
 * Platform / scaffolding DTOs owned by F1:
 *  - settings (GET/PUT /settings, POST /settings/test-connection)
 *  - repos (POST/GET /repos, refresh, delete)
 *  - pulls (GET /repos/:id/pulls, GET /pulls/:id)
 *  - context (Project Context folder)
 */

// ---- Feature → model selection ----
/** System LLM features whose model is selectable in Settings (per-workspace). */
export const FeatureModelId = z.enum([
  'onboarding',
  'review_intent',
  'risk_brief',
  'conformance',
  'conventions',
]);
export type FeatureModelId = z.infer<typeof FeatureModelId>;

/** A chosen provider + model for one feature. */
export const FeatureModelChoice = z.object({
  provider: Provider,
  model: z.string().min(1),
});
export type FeatureModelChoice = z.infer<typeof FeatureModelChoice>;

/**
 * Registry of the selectable features: stable id, display label, and the
 * built-in default used when the workspace hasn't overridden the choice. The
 * defaults MIRROR each module's constants, so behaviour is unchanged until a
 * model is explicitly picked.
 */
export interface FeatureModelDef {
  id: FeatureModelId;
  label: string;
  description: string;
  defaultProvider: Provider;
  defaultModel: string;
}
export const FEATURE_MODELS: FeatureModelDef[] = [
  {
    id: 'onboarding',
    label: 'Onboarding Tour',
    description: 'Writes the per-repo onboarding tour.',
    defaultProvider: 'openrouter',
    defaultModel: 'deepseek/deepseek-v4-flash',
  },
  {
    id: 'review_intent',
    label: 'PR Review · Intent',
    description: 'Derives a PR’s intent and scope before review.',
    defaultProvider: 'openrouter',
    defaultModel: 'deepseek/deepseek-v4-flash',
  },
  {
    id: 'risk_brief',
    label: 'Risk Brief',
    description: 'Assesses merge risks for a pull request.',
    defaultProvider: 'openai',
    defaultModel: 'gpt-4.1',
  },
  {
    id: 'conformance',
    label: 'Conformance',
    description: 'Checks a PR against the project spec.',
    defaultProvider: 'openai',
    defaultModel: 'gpt-4.1',
  },
  {
    id: 'conventions',
    label: 'Conventions',
    description: 'Extracts coding conventions from the repo.',
    defaultProvider: 'openai',
    defaultModel: 'gpt-5.4',
  },
];

// ---- Settings ----
/**
 * Non-secret prefs/config. Secrets (API keys) are NOT stored here — they go
 * through SecretsProvider (.env in MVP). Settings is a flat key/value bag,
 * surfaced as a typed object for the well-known keys.
 */
export const SettingsKnown = z.object({
  polling_interval_min: z.number().int().min(1).default(5),
  theme: z.enum(['dark', 'light']).default('dark'),
  density: z.enum(['regular', 'compact']).default('regular'),
  sync_to_folder: z.boolean().default(true),
  automatic_reviews: z.boolean().default(false),
  /** Per-feature model overrides (provider+model), keyed by FeatureModelId. */
  feature_models: z.record(FeatureModelId, FeatureModelChoice).default({}),
});
export type SettingsKnown = z.infer<typeof SettingsKnown>;

/** Full settings payload: well-known keys + arbitrary extras. */
export const Settings = SettingsKnown.passthrough();
export type Settings = z.infer<typeof Settings>;

export const SettingsUpdate = Settings.partial();
export type SettingsUpdate = z.infer<typeof SettingsUpdate>;

// ---- Connection test ----
export const ConnTestProvider = z.enum(['openai', 'anthropic', 'openrouter', 'github']);
export type ConnTestProvider = z.infer<typeof ConnTestProvider>;

export const ConnTestRequest = z.object({
  provider: ConnTestProvider,
  /** Optional API key/PAT to persist and then test (BYO key from the UI). */
  key: z.string().min(1).optional(),
});
export type ConnTestRequest = z.infer<typeof ConnTestRequest>;

export const ConnTestResult = z.object({
  provider: ConnTestProvider,
  ok: z.boolean(),
  message: z.string(),
  detail: z.unknown().optional(),
});
export type ConnTestResult = z.infer<typeof ConnTestResult>;

// ---- Secrets status (which provider keys are configured; never the values) ----
/** Boolean per provider: true ⇒ a key/PAT is stored. The value is never exposed. */
export const SecretsStatus = z.object({
  openai: z.boolean(),
  anthropic: z.boolean(),
  openrouter: z.boolean(),
  github: z.boolean(),
});
export type SecretsStatus = z.infer<typeof SecretsStatus>;

// ---- Repos ----
export const RepoInput = z.object({
  url: z.string().url(),
});
export type RepoInput = z.infer<typeof RepoInput>;

export const Repo = z.object({
  id: z.string(),
  workspace_id: z.string(),
  owner: z.string(),
  name: z.string(),
  full_name: z.string(),
  default_branch: z.string(),
  clone_path: z.string().nullable(),
  last_polled_at: z.string().nullable(),
  created_by: z.string().nullable(),
});
export type Repo = z.infer<typeof Repo>;

// ---- Pull requests ----
export const PrStatus = z.enum(['needs_review', 'reviewed', 'stale', 'open', 'closed', 'merged']);
export type PrStatus = z.infer<typeof PrStatus>;

export const PrMeta = z.object({
  id: z.string().nullish(),
  number: z.number().int(),
  title: z.string(),
  author: z.string(),
  branch: z.string(),
  base: z.string(),
  head_sha: z.string(),
  additions: z.number().int(),
  deletions: z.number().int(),
  files_count: z.number().int(),
  status: PrStatus,
  opened_at: z.string().nullish(),
  updated_at: z.string().nullish(),
  // Latest-review score (list endpoint only; null/absent until reviewed).
  score: z.number().int().nullish(),
  // Cost (USD) of the run that produced the latest review above (same run,
  // list endpoint only; null/absent until reviewed).
  cost_usd: z.number().nullish(),
  // Findings severity breakdown of the same latest review above (not summed
  // across every agent/run on the PR); null/absent until reviewed.
  critical_count: z.number().int().nullish(),
  warning_count: z.number().int().nullish(),
  suggestion_count: z.number().int().nullish(),
});
export type PrMeta = z.infer<typeof PrMeta>;

export const PrFile = z.object({
  path: z.string(),
  additions: z.number().int(),
  deletions: z.number().int(),
  patch: z.string().nullish(),
});
export type PrFile = z.infer<typeof PrFile>;

export const PrCommit = z.object({
  sha: z.string(),
  message: z.string(),
  author: z.string(),
  committed_at: z.string().nullish(),
});
export type PrCommit = z.infer<typeof PrCommit>;

export const IssueMeta = z.object({
  number: z.number().int(),
  title: z.string(),
  body: z.string().nullish(),
  state: z.string(),
});
export type IssueMeta = z.infer<typeof IssueMeta>;

export const PrDetail = PrMeta.extend({
  body: z.string().nullish(),
  files: z.array(PrFile),
  commits: z.array(PrCommit),
  linked_issue: IssueMeta.nullish(),
});
export type PrDetail = z.infer<typeof PrDetail>;

// ---- PR review (inline) comments ----
/**
 * A GitHub PR review comment anchored to a diff line. Mirrors the fields the
 * "Files changed" tab needs to render threads inline; `line` is the position in
 * the current diff (null when GitHub can no longer anchor it → `is_outdated`).
 */
export const PrReviewComment = z.object({
  id: z.number().int(),
  path: z.string(),
  line: z.number().int().nullable(),
  original_line: z.number().int().nullable(),
  side: z.enum(['LEFT', 'RIGHT']),
  body: z.string(),
  user: z.string(),
  created_at: z.string(),
  html_url: z.string(),
  in_reply_to_id: z.number().int().nullable(),
  /** GitHub couldn't anchor it to the current diff (line == null). */
  is_outdated: z.boolean(),
});
export type PrReviewComment = z.infer<typeof PrReviewComment>;

/** Body for POST /pulls/:id/comments (create one inline comment / reply). */
export const PrCommentInput = z.object({
  path: z.string().min(1),
  line: z.number().int().positive(),
  side: z.enum(['LEFT', 'RIGHT']).optional(),
  body: z.string().min(1),
  /** Reply to an existing review comment thread (its comment id). */
  in_reply_to: z.number().int().optional(),
});
export type PrCommentInput = z.infer<typeof PrCommentInput>;

// ---- Project Context ----
/** One discovered `.md` document under a repo's configured search roots. */
export const ContextDocument = z.object({
  /** Repo-relative path. */
  path: z.string(),
  /** Which configured search root it was found under (e.g. "specs", "docs"). */
  source_folder: z.string(),
  /** Document type/kind label (currently always the extension, e.g. "md"). */
  type: z.string(),
  /** Estimated token count of the document's full text (AC-2). */
  tokens: z.number().int(),
  bytes: z.number().int(),
  /** Number of agents (direct + inherited via enabled skills) that would
   *  inject this document (AC-8). */
  used_by_agents: z.number().int(),
  /** True for an attached-but-absent file (E-2) — only set on attachment
   *  reads, not on the discovery listing. */
  missing: z.boolean(),
});
export type ContextDocument = z.infer<typeof ContextDocument>;

/** GET /repos/:repoId/context response. */
export const ContextListing = z.object({
  documents: z.array(ContextDocument),
  total_tokens: z.number().int(),
  total_files: z.number().int(),
  /** Non-null carries the no-clone degraded case (AC-3/E-1). */
  degraded_reason: z.string().nullable(),
  /** Configured search-root folder names (`AppConfig.projectContextRoots`) —
   *  the new-document dialog's root picker has no other way to learn them
   *  (Rec-4); inferring from `source_folder` fails on a repo with zero
   *  discovered documents (E-14). `.default([])` so older fixtures parse. */
  roots: z.array(z.string()).default([]),
});
export type ContextListing = z.infer<typeof ContextListing>;

/** One document reference in an attachment set — path + persisted order. */
export const ContextAttachment = z.object({
  path: z.string(),
  order: z.number().int(),
});
export type ContextAttachment = z.infer<typeof ContextAttachment>;

/** Attachments this surface holds against a repo other than the active one. */
export const OtherRepoAttachment = z.object({
  repo_id: z.string(),
  path: z.string(),
  order: z.number().int(),
});
export type OtherRepoAttachment = z.infer<typeof OtherRepoAttachment>;

/** GET /skills/:id/context, GET /agents/:id/context response. */
export const ContextAttachmentSet = z.object({
  repo_id: z.string(),
  documents: z.array(ContextAttachment),
  total_tokens: z.number().int(),
  /** Attachments this surface holds against OTHER repos (E-8 / WI11).
   *  Not injected for runs on `repo_id`. `.default([])` so older fixtures parse. */
  other_repo_documents: z.array(OtherRepoAttachment).default([]),
});
export type ContextAttachmentSet = z.infer<typeof ContextAttachmentSet>;

/** Body for POST /skills/:id/context, POST /agents/:id/context — replaces
 *  the whole attached set for that surface, ordered by array index. */
export const SetContextBody = z.object({
  repo_id: z.string(),
  paths: z.array(z.string()),
});
export type SetContextBody = z.infer<typeof SetContextBody>;

// ---- Project Context — in-app authoring (SPEC-01 amendment, AC-29–AC-53) ----
/** GET /repos/:repoId/context/document response — widened from the original
 *  preview-only `{ path, content }` shape with a content-hash staleness
 *  token (Rec-1): sha256 hex of the file's bytes, required back on save so a
 *  concurrent out-of-band edit is rejected instead of silently overwritten
 *  (AC-37). An mtime was considered and rejected — the dev environment is
 *  win32, where a same-tick out-of-band write can share an mtime. */
export const ContextDocumentContent = z.object({
  path: z.string(),
  content: z.string(),
  revision: z.string(),
});
export type ContextDocumentContent = z.infer<typeof ContextDocumentContent>;

/** Body for PUT /repos/:repoId/context/document (save an existing document).
 *  `revision` must match the current on-disk content hash (AC-37) or the
 *  save is rejected with `ConflictError` (409) and nothing is written. */
export const SaveContextDocumentBody = z.object({
  path: z.string(),
  content: z.string(),
  revision: z.string(),
});
export type SaveContextDocumentBody = z.infer<typeof SaveContextDocumentBody>;

/** Body for POST /repos/:repoId/context/document (create a new document).
 *  No staleness token — creation is an atomic exclusive write (AC-44), not a
 *  read-modify-write. */
export const CreateContextDocumentBody = z.object({
  path: z.string(),
  content: z.string(),
});
export type CreateContextDocumentBody = z.infer<typeof CreateContextDocumentBody>;

/** Response for both the save and create write paths — the document's fresh
 *  metadata (AC-40) plus the new revision so the client can keep editing
 *  without an extra round trip. */
export const ContextWriteResult = z.object({
  document: ContextDocument,
  revision: z.string(),
});
export type ContextWriteResult = z.infer<typeof ContextWriteResult>;

export const IndexStatus = z.object({
  status: z.enum(['idle', 'cloning', 'parsing', 'embedding', 'done', 'error']),
  pct: z.number().min(0).max(100),
  message: z.string().nullish(),
  chunks_indexed: z.number().int().nullish(),
});
export type IndexStatus = z.infer<typeof IndexStatus>;

// ---- Run request (review trigger; owned by A2, contract lives here) ----
export const RunRequest = z.object({
  agentId: z.string().optional(),
  all: z.boolean().optional(),
});
export type RunRequest = z.infer<typeof RunRequest>;

// ---- Structured API error envelope (returned by the API; UX taxonomy is FE) ----
export const ApiErrorBody = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;
