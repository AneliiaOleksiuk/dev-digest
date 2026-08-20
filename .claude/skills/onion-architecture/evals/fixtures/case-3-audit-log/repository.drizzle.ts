import { eq, desc } from 'drizzle-orm';
import * as t from '../../db/schema.js';
import type { AuditLogRepository } from './repository.js';
import type { Db } from '../../db/client.js';
import type { AuditLogRow, AuditLogInsert } from '../../db/rows.js';

export class DrizzleAuditLogRepository implements AuditLogRepository {
  constructor(private db: Db) {}

  listForWorkspace(workspaceId: string, limit: number): Promise<AuditLogRow[]> {
    return this.db.query.auditLogs.findMany({
      where: eq(t.auditLogs.workspaceId, workspaceId),
      orderBy: desc(t.auditLogs.createdAt),
      limit,
    });
  }

  insert(values: AuditLogInsert): Promise<AuditLogRow> {
    return this.db
      .insert(t.auditLogs)
      .values(values)
      .returning()
      .then((rows) => rows[0]);
  }
}
