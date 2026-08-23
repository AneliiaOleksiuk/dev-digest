import { eq } from 'drizzle-orm';
import * as t from '../../db/schema.js';
import type { AnalyticsRepository } from './repository.js';
import type { Db } from '../../db/client.js';
import type { AnalyticsSnapshotRow, AnalyticsSnapshotInsert } from '../../db/rows.js';

export class DrizzleAnalyticsRepository implements AnalyticsRepository {
  constructor(private db: Db) {}

  listSnapshots(workspaceId: string): Promise<AnalyticsSnapshotRow[]> {
    return this.db.query.analyticsSnapshots.findMany({
      where: eq(t.analyticsSnapshots.workspaceId, workspaceId),
    });
  }

  insertSnapshot(values: AnalyticsSnapshotInsert): Promise<AnalyticsSnapshotRow> {
    return this.db
      .insert(t.analyticsSnapshots)
      .values(values)
      .returning()
      .then((rows) => rows[0]);
  }
}
