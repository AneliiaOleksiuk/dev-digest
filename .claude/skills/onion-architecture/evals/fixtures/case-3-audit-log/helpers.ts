import type { AuditLogRow } from './repository.js';

export interface AuditLogDto {
  id: string;
  actorId: string;
  action: string;
  createdAt: string;
}

export function auditLogToDto(row: AuditLogRow): AuditLogDto {
  return {
    id: row.id,
    actorId: row.actorId,
    action: row.action,
    createdAt: row.createdAt.toISOString(),
  };
}
