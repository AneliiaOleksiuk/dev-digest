import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { DigestService } from './service.js';

export const digestRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/workspaces/:workspaceId/digest/send',
    {
      schema: {
        params: z.object({ workspaceId: z.string() }),
        body: z.object({ email: z.string().email() }),
      },
    },
    async (req) => {
      const service = new DigestService(app.container.digestRepo, app.container.digestMailer);
      await service.sendDailyDigest(req.params.workspaceId, req.body.email);
      return { ok: true };
    },
  );
};
