import type { Db } from '../../db/client.js';
import type { AuditLogRow, AuditLogInsert } from '../../db/rows.js';

export interface AuditLogRepository {
  listForWorkspace(workspaceId: string, limit: number): Promise<AuditLogRow[]>;
  insert(values: AuditLogInsert): Promise<AuditLogRow>;
}
