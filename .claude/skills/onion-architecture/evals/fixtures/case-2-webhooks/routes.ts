import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { WebhookService } from './service.js';

const RegisterBody = z.object({ targetUrl: z.string().url() });

export default async function webhooksRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new WebhookService(container.webhookRepo, container);

  app.get('/webhooks', async (req) => {
    const { workspaceId } = getContext(req);
    return service.listForWorkspace(workspaceId);
  });

  app.post('/webhooks', { schema: { body: RegisterBody } }, async (req) => {
    const { workspaceId } = getContext(req);
    return service.register(workspaceId, req.body.targetUrl);
  });
}
