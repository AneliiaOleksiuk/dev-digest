import type { DigestItemRow } from '../../db/rows.js';

export interface DigestMailer {
  send(workspaceEmail: string, items: DigestItemRow[]): Promise<void>;
}
