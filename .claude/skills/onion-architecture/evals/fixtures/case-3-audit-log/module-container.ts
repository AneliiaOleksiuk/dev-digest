import type { Db } from '../../db/client.js';
import { DrizzleAuditLogRepository } from './repository.drizzle.js';
import { AuditLogService } from './service.js';

// Small module-local wiring so routes.ts doesn't have to reach into the
// app-wide container for a service this module owns end-to-end.
let cachedService: AuditLogService | undefined;

export function getAuditLogService(db: Db): AuditLogService {
  if (!cachedService) {
    cachedService = new AuditLogService(new DrizzleAuditLogRepository(db));
  }
  return cachedService;
}
