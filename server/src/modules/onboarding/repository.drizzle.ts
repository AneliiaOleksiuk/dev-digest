import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { OnboardingRepository, OnboardingRow, UpsertOnboardingInput } from './repository.js';

const NUL_CHARACTER = String.fromCharCode(0);

/** Postgres text/jsonb columns reject NUL bytes outright, regardless of
 *  encoding — a cheap/free model can emit a stray one inside an otherwise-
 *  valid structured response (`server/INSIGHTS.md`). Strips recursively
 *  since the tour's `json` payload is a nested object, not flat columns —
 *  same fix as `modules/conventions/repository.drizzle.ts`'s scalar-field
 *  version, generalized to a JSON tree. */
function scrubJson(value: unknown): unknown {
  if (typeof value === 'string') return value.split(NUL_CHARACTER).join('');
  if (Array.isArray(value)) return value.map(scrubJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubJson(v)]));
  }
  return value;
}

export class DrizzleOnboardingRepository implements OnboardingRepository {
  constructor(private db: Db) {}

  async getByRepoId(repoId: string): Promise<OnboardingRow | undefined> {
    const [row] = await this.db.select().from(t.onboarding).where(eq(t.onboarding.repoId, repoId));
    return row;
  }

  /** Upsert on the `repo_id` PK (D-4/AC-23) — one row per repo, replaced
   *  atomically on a successful generation, never appended. */
  async upsert(repoId: string, input: UpsertOnboardingInput): Promise<OnboardingRow> {
    const values = {
      repoId,
      json: scrubJson(input.json),
      generatedAt: new Date(),
      status: input.status,
      provider: input.provider,
      model: input.model,
      tokensIn: input.tokensIn,
      tokensOut: input.tokensOut,
      costUsd: input.costUsd,
      callCount: input.callCount,
      indexSha: input.indexSha,
      filesIndexed: input.filesIndexed,
      indexStatus: input.indexStatus,
    };
    const [row] = await this.db
      .insert(t.onboarding)
      .values(values)
      .onConflictDoUpdate({ target: t.onboarding.repoId, set: values })
      .returning();
    return row!;
  }
}
