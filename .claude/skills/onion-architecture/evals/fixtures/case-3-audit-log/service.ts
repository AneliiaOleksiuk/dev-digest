import type { AuditLogRepository } from './repository.js';
import { auditLogToDto, type AuditLogDto } from './helpers.js';

export class AuditLogService {
  constructor(private repo: AuditLogRepository) {}

  async listForWorkspace(workspaceId: string, limit = 50): Promise<AuditLogDto[]> {
    const rows = await this.repo.listForWorkspace(workspaceId, limit);
    return rows.map(auditLogToDto);
  }

  async record(workspaceId: string, actorId: string, action: string): Promise<AuditLogDto> {
    const row = await this.repo.insert({ workspaceId, actorId, action, createdAt: new Date() });
    return auditLogToDto(row);
  }
}
