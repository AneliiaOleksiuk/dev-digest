import type { DigestItemRow } from '../../db/rows.js';

export interface DigestRepository {
  listPendingForWorkspace(workspaceId: string): Promise<DigestItemRow[]>;
  markSent(workspaceId: string, ids: string[]): Promise<void>;
}
