import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type {
  SmartDiffFindingLine,
  SmartDiffPrFile,
  SmartDiffRepository,
} from './repository.js';

export class DrizzleSmartDiffRepository implements SmartDiffRepository {
  constructor(private db: Db) {}

  async getPull(workspaceId: string, prId: string): Promise<{ id: string } | undefined> {
    const [row] = await this.db
      .select({ id: t.pullRequests.id })
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    return row;
  }

  async getPrFiles(prId: string): Promise<SmartDiffPrFile[]> {
    const rows = await this.db
      .select({
        path: t.prFiles.path,
        additions: t.prFiles.additions,
        deletions: t.prFiles.deletions,
      })
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, prId));
    return rows;
  }

  async latestReviewFindings(prId: string): Promise<SmartDiffFindingLine[]> {
    const [latest] = await this.db
      .select({ id: t.reviews.id })
      .from(t.reviews)
      .where(eq(t.reviews.prId, prId))
      .orderBy(desc(t.reviews.createdAt))
      .limit(1);

    if (!latest) return [];

    const rows = await this.db
      .select({
        file: t.findings.file,
        startLine: t.findings.startLine,
        endLine: t.findings.endLine,
      })
      .from(t.findings)
      .where(eq(t.findings.reviewId, latest.id));

    return rows.map((r) => ({
      file: r.file,
      start_line: r.startLine,
      end_line: r.endLine,
    }));
  }
}
