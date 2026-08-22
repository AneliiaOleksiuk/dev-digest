import type { Db } from '../../db/client.js';
import type { WebhookSubRow, WebhookSubInsert } from '../../db/rows.js';

export interface WebhookRepository {
  getById(workspaceId: string, id: string): Promise<WebhookSubRow | undefined>;
  listForWorkspace(workspaceId: string): Promise<WebhookSubRow[]>;
  insert(values: WebhookSubInsert): Promise<WebhookSubRow>;
}
