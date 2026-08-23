import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { eq, and, desc } from 'drizzle-orm';

export type NotificationRow = typeof t.notifications.$inferSelect;
export type NotificationInsert = typeof t.notifications.$inferInsert;

export class NotificationRepository {
  constructor(private db: Db) {}

  listForWorkspace(workspaceId: string): Promise<NotificationRow[]> {
    return this.db.query.notifications.findMany({
      where: eq(t.notifications.workspaceId, workspaceId),
      orderBy: desc(t.notifications.createdAt),
    });
  }

  markRead(workspaceId: string, id: string): Promise<NotificationRow | undefined> {
    return this.db
      .update(t.notifications)
      .set({ readAt: new Date() })
      .where(and(eq(t.notifications.workspaceId, workspaceId), eq(t.notifications.id, id)))
      .returning()
      .then((rows) => rows[0]);
  }

  insert(values: NotificationInsert): Promise<NotificationRow> {
    return this.db
      .insert(t.notifications)
      .values(values)
      .returning()
      .then((rows) => rows[0]);
  }
}
