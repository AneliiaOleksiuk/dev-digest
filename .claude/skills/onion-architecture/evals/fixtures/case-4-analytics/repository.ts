import type { AnalyticsSnapshotRow, AnalyticsSnapshotInsert } from '../../db/rows.js';

export interface AnalyticsRepository {
  listSnapshots(workspaceId: string): Promise<AnalyticsSnapshotRow[]>;
  insertSnapshot(values: AnalyticsSnapshotInsert): Promise<AnalyticsSnapshotRow>;
}
