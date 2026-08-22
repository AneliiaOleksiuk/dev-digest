import { eq, and, inArray } from 'drizzle-orm';
import * as t from '../../db/schema.js';
import type { DigestRepository } from './repository.js';
import type { Db } from '../../db/client.js';
import type { DigestItemRow } from '../../db/rows.js';

export class DrizzleDigestRepository implements DigestRepository {
  constructor(private db: Db) {}

  listPendingForWorkspace(workspaceId: string): Promise<DigestItemRow[]> {
    return this.db.query.digestItems.findMany({
      where: and(eq(t.digestItems.workspaceId, workspaceId), eq(t.digestItems.sent, false)),
    });
  }

  async markSent(workspaceId: string, ids: string[]): Promise<void> {
    await this.db.update(t.digestItems).set({ sent: true }).where(
      and(eq(t.digestItems.workspaceId, workspaceId), inArray(t.digestItems.id, ids)),
    );
  }
}
