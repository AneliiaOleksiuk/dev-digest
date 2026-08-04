import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { ConventionsService } from './service.js';

/**
 * Conventions module.
 *   POST  /repos/:id/conventions/extract → scan the repo, persist grounded candidates
 *   GET   /repos/:id/conventions         → list candidates for a repo
 *   PATCH /conventions/:id               → accept/reject/edit one candidate
 *   POST  /conventions/promote           → bundle accepted candidates into one skill
 */

const UpdateConventionBody = z.object({
  status: z.enum(['pending', 'accepted', 'rejected']).optional(),
  rule: z.string().min(1).optional(),
  evidence_path: z.string().min(1).optional(),
  evidence_snippet: z.string().min(1).optional(),
});

const PromoteBody = z.object({
  convention_ids: z.array(z.string().uuid()).min(1),
  skill: z.object({
    name: z.string().min(1),
    description: z.string().min(1),
    body: z.string().min(1),
    enabled: z.boolean().optional(),
  }),
});

export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ConventionsService(app.container.conventionsRepo, app.container);

  app.post(
    '/repos/:id/conventions/extract',
    { schema: { params: IdParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.extract(workspaceId, req.params.id);
    },
  );

  app.get('/repos/:id/conventions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId, req.params.id);
  });

  app.patch(
    '/conventions/:id',
    { schema: { params: IdParams, body: UpdateConventionBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const candidate = await service.update(workspaceId, req.params.id, req.body);
      if (!candidate) throw new NotFoundError('Convention candidate not found');
      return candidate;
    },
  );

  app.post('/conventions/promote', { schema: { body: PromoteBody } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.promote(workspaceId, {
      conventionIds: req.body.convention_ids,
      skill: req.body.skill,
    });
    reply.status(201);
    return skill;
  });
}
