import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { BlastPull, BlastRepository, PriorPrRow } from './repository.js';

export class DrizzleBlastRepository implements BlastRepository {
  constructor(private db: Db) {}

  async getPull(workspaceId: string, prId: string): Promise<BlastPull | undefined> {
    const [row] = await this.db
      .select({ id: t.pullRequests.id, repoId: t.pullRequests.repoId })
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    return row;
  }

  async getPrFiles(prId: string): Promise<string[]> {
    const rows = await this.db
      .select({ path: t.prFiles.path })
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, prId));
    return rows.map((r) => r.path);
  }

  async getPriorPrsForFiles(
    workspaceId: string,
    repoId: string,
    excludePrId: string,
    paths: string[],
    limit: number,
  ): Promise<PriorPrRow[]> {
    // An empty `inArray(...)` is a SQL foot-gun (matches nothing, or in some
    // drivers errors outright) — short-circuit rather than issue the query.
    if (paths.length === 0) return [];

    // Reused (not re-declared) in both `select` and `orderBy` so Postgres sees
    // the exact same aggregate expression in both clauses.
    const overlappingFiles = sql<number>`count(distinct ${t.prFiles.path})`.mapWith(Number);

    const rows = await this.db
      .select({
        id: t.pullRequests.id,
        number: t.pullRequests.number,
        title: t.pullRequests.title,
        author: t.pullRequests.author,
        overlappingFiles,
      })
      .from(t.prFiles)
      .innerJoin(t.pullRequests, eq(t.prFiles.prId, t.pullRequests.id))
      .where(
        and(
          eq(t.pullRequests.workspaceId, workspaceId),
          eq(t.pullRequests.repoId, repoId),
          ne(t.pullRequests.id, excludePrId),
          inArray(t.prFiles.path, paths),
        ),
      )
      .groupBy(t.pullRequests.id, t.pullRequests.number, t.pullRequests.title, t.pullRequests.author)
      // `number` (not the nullable `opened_at`/`updated_at`) is the recency
      // proxy: notNull + unique per repo (`pr_repo_number_uq`).
      .orderBy(desc(t.pullRequests.number), desc(overlappingFiles))
      .limit(limit);

    return rows;
  }
}
