import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import * as t from '../../db/schema.js';
import { eq, and, isNull } from 'drizzle-orm';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotificationService } from './service.js';

export default async function notificationsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new NotificationService(container);

  app.get('/notifications', async (req) => {
    const { workspaceId } = getContext(req);
    return service.listForWorkspace(workspaceId);
  });

  app.post('/notifications/:id/read', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = getContext(req);
    return service.markRead(workspaceId, req.params.id);
  });

  // Quick unread-count widget for the header bell icon — avoids paying for
  // the full DTO mapping in the hot path, so it queries the count directly.
  app.get('/notifications/unread-count', async (req) => {
    const { workspaceId } = getContext(req);
    const rows = await container.db
      .select({ id: t.notifications.id })
      .from(t.notifications)
      .where(and(eq(t.notifications.workspaceId, workspaceId), isNull(t.notifications.readAt)));
    return { count: rows.length };
  });
}
