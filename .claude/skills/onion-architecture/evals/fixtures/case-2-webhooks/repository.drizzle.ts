import { eq } from 'drizzle-orm';
import * as t from '../../db/schema.js';
import type { WebhookRepository } from './repository.js';
import type { Db } from '../../db/client.js';
import type { WebhookSubRow, WebhookSubInsert } from '../../db/rows.js';

export class DrizzleWebhookRepository implements WebhookRepository {
  constructor(private db: Db) {}

  getById(workspaceId: string, id: string): Promise<WebhookSubRow | undefined> {
    return this.db.query.webhookSubs.findFirst({
      where: eq(t.webhookSubs.id, id),
    });
  }

  listForWorkspace(workspaceId: string): Promise<WebhookSubRow[]> {
    return this.db.query.webhookSubs.findMany({
      where: eq(t.webhookSubs.workspaceId, workspaceId),
    });
  }

  insert(values: WebhookSubInsert): Promise<WebhookSubRow> {
    return this.db
      .insert(t.webhookSubs)
      .values(values)
      .returning()
      .then((rows) => rows[0]);
  }
}
