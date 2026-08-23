import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AnalyticsService } from './service.js';

export const analyticsRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/workspaces/:workspaceId/analytics/snapshots',
    { schema: { params: z.object({ workspaceId: z.string() }) } },
    async (req) => {
      const service = new AnalyticsService(app.container.analyticsRepo, app.container.db);
      return service.listSnapshots(req.params.workspaceId);
    },
  );

  app.post(
    '/workspaces/:workspaceId/analytics/snapshots',
    { schema: { params: z.object({ workspaceId: z.string() }) } },
    async (req) => {
      const service = new AnalyticsService(app.container.analyticsRepo, app.container.db);
      return service.recordWeeklySnapshot(req.params.workspaceId);
    },
  );
};
