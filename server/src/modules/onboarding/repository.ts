/**
 * Onboarding data-access port. Interface + plain row types only — no Drizzle
 * import (mirrors `modules/blast/repository.ts`).
 */
import type { OnboardingRow } from '../../db/rows.js';
export type { OnboardingRow };

export interface UpsertOnboardingInput {
  /** The grounded `{sections}` payload — validated against the `Onboarding`
   *  contract by the caller before this is invoked. */
  json: unknown;
  status: 'ok' | 'partial_index' | 'no_clone' | 'not_indexed' | 'llm_failed' | 'never_generated';
  provider: string | null;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  callCount: number;
  indexSha: string | null;
  filesIndexed: number | null;
  indexStatus: string | null;
}

/** One row per repo (`repo_id` primary key, D-4/AC-23) — `upsert` always
 *  replaces atomically, never appends. */
export interface OnboardingRepository {
  getByRepoId(repoId: string): Promise<OnboardingRow | undefined>;
  upsert(repoId: string, input: UpsertOnboardingInput): Promise<OnboardingRow>;
}
