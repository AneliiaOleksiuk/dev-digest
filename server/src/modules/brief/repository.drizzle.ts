import { and, count, desc, eq } from 'drizzle-orm';
import type { PrIntentRecord } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { ReviewRepository } from '../reviews/repository.js';
import type { BriefPull, BriefRepoRow, BriefRepository, UpsertBriefInput } from './repository.js';
import type { PrBriefRow } from '../../db/rows.js';

const NUL_CHARACTER = String.fromCharCode(0);

/** Postgres text/jsonb columns reject NUL bytes outright — a cheap model can
 *  emit a stray one inside otherwise-valid structured output
 *  (`server/INSIGHTS.md`). Recursive strip, same shape as
 *  `modules/onboarding/repository.drizzle.ts`'s `scrubJson`. */
function scrubJson(value: unknown): unknown {
  if (typeof value === 'string') return value.split(NUL_CHARACTER).join('');
  if (Array.isArray(value)) return value.map(scrubJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubJson(v)]));
  }
  return value;
}

export class DrizzleBriefRepository implements BriefRepository {
  constructor(private db: Db) {}

  async getPull(workspaceId: string, prId: string): Promise<BriefPull | undefined> {
    const [row] = await this.db
      .select({
        id: t.pullRequests.id,
        repoId: t.pullRequests.repoId,
        base: t.pullRequests.base,
        headSha: t.pullRequests.headSha,
        title: t.pullRequests.title,
        body: t.pullRequests.body,
      })
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    return row;
  }

  async getRepo(repoId: string): Promise<BriefRepoRow | undefined> {
    const [row] = await this.db
      .select({
        id: t.repos.id,
        owner: t.repos.owner,
        name: t.repos.name,
        clonePath: t.repos.clonePath,
      })
      .from(t.repos)
      .where(eq(t.repos.id, repoId));
    return row;
  }

  /** Delegates to the reviews module's own repository (a sibling module's
   *  concrete repository, constructed here — legitimate in an infrastructure
   *  file, unlike the onion violation flagged in server/INSIGHTS.md for
   *  service.ts constructing one). No new pr_intent reader duplicated. */
  async getIntentRecord(prId: string): Promise<PrIntentRecord | undefined> {
    return new ReviewRepository(this.db).getIntentRecord(prId);
  }

  async countCommits(prId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(t.prCommits)
      .where(eq(t.prCommits.prId, prId));
    return row?.n ?? 0;
  }

  async getBrief(prId: string, headSha: string): Promise<PrBriefRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.prBrief)
      .where(and(eq(t.prBrief.prId, prId), eq(t.prBrief.headSha, headSha)));
    return row;
  }

  async getLatestBrief(prId: string): Promise<PrBriefRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.prBrief)
      .where(eq(t.prBrief.prId, prId))
      .orderBy(desc(t.prBrief.generatedAt))
      .limit(1);
    return row;
  }

  async listBriefs(prId: string, limit: number): Promise<PrBriefRow[]> {
    return this.db
      .select()
      .from(t.prBrief)
      .where(eq(t.prBrief.prId, prId))
      .orderBy(desc(t.prBrief.generatedAt))
      .limit(limit);
  }

  async upsertBrief(prId: string, headSha: string, input: UpsertBriefInput): Promise<PrBriefRow> {
    const values = {
      prId,
      headSha,
      json: scrubJson(input.json),
      provider: input.provider,
      model: input.model,
      inputTokens: input.inputTokens,
      tokensIn: input.tokensIn,
      tokensOut: input.tokensOut,
      costUsd: input.costUsd,
      droppedRiskRefs: input.droppedRiskRefs,
      droppedFocusItems: input.droppedFocusItems,
      droppedInputs: input.droppedInputs,
      generatedAt: new Date(),
    };
    const [row] = await this.db
      .insert(t.prBrief)
      .values(values)
      .onConflictDoUpdate({ target: [t.prBrief.prId, t.prBrief.headSha], set: values })
      .returning();
    return row!;
  }
}
