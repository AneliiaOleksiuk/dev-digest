/**
 * Brief data-access port. Interface + plain row types only — no Drizzle
 * import (mirrors `modules/blast/repository.ts` and
 * `modules/onboarding/repository.ts`).
 */
import type { PrIntentRecord } from '@devdigest/shared';
import type { PrBriefRow } from '../../db/rows.js';
export type { PrBriefRow };

/** Just enough of `pull_requests` for this module — a superset shape
 *  compatible with `reviews/diff-loader.ts`'s `PullRow` expectations so the
 *  sources adapter can re-resolve the full row when it needs to (`sources.node.ts`). */
export interface BriefPull {
  id: string;
  repoId: string;
  base: string;
  headSha: string;
  title: string;
  body: string | null;
}

/** Just enough of `repos` for this module. */
export interface BriefRepoRow {
  id: string;
  owner: string;
  name: string;
  clonePath: string | null;
}

export interface UpsertBriefInput {
  /** `{ ...Brief, input_status: Omit<BriefInputStatus, 'dropped_inputs'> }` —
   *  validated by the caller (`service.ts`) against the module's own
   *  stored-json contract before this is invoked, same discipline as
   *  `onboarding/repository.ts`'s `UpsertOnboardingInput.json`. */
  json: unknown;
  provider: string;
  model: string;
  inputTokens: number;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  droppedRiskRefs: number;
  droppedFocusItems: number;
  droppedInputs: string[];
}

export interface BriefRepository {
  /** Workspace-scoped existence check (drives the 404) — also yields the
   *  fields the service/prompt need without a second round trip. */
  getPull(workspaceId: string, prId: string): Promise<BriefPull | undefined>;

  getRepo(repoId: string): Promise<BriefRepoRow | undefined>;

  /** Persisted intent record for the PR, whatever SHA it describes — the
   *  caller compares `head_sha` itself (AC-6, E-3); this never classifies. */
  getIntentRecord(prId: string): Promise<PrIntentRecord | undefined>;

  /** Total commit count for the PR (`pr_commits`) — the Why Timeline's
   *  honest-gap denominator (AC-34/UX-8). */
  countCommits(prId: string): Promise<number>;

  /** Exact `(prId, headSha)` lookup. */
  getBrief(prId: string, headSha: string): Promise<PrBriefRow | undefined>;

  /** Newest persisted brief for the PR, any SHA — the AC-17 staleness source. */
  getLatestBrief(prId: string): Promise<PrBriefRow | undefined>;

  /** All persisted briefs for the PR, newest first, capped at `limit`. */
  listBriefs(prId: string, limit: number): Promise<PrBriefRow[]>;

  /** Replace-not-append upsert on the `(prId, headSha)` composite PK (AC-13). */
  upsertBrief(prId: string, headSha: string, input: UpsertBriefInput): Promise<PrBriefRow>;
}
