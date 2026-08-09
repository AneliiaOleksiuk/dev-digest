import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { BlastRadiusResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BlastService } from './service.js';

/**
 * Blast module.
 *   GET /pulls/:id/blast → symbols declared in the PR's changed files, their
 *   direct callers, and the endpoints/crons those callers reach. Read
 *   entirely from the existing repo-intel index — never a model.
 */
export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new BlastService(app.container.blastRepo, app.container);

  app.get(
    '/pulls/:id/blast',
    { schema: { params: IdParams } },
    async (req): Promise<BlastRadiusResponse> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.getBlastRadius(workspaceId, req.params.id);
    },
  );
}
