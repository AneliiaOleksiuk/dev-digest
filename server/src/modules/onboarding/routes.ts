import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { OnboardingTourResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { OnboardingService } from './service.js';

/**
 * Onboarding module.
 *   GET  /repos/:id/onboarding          → the stored tour (or a model-free
 *                                          skeleton) — NEVER a model call.
 *   POST /repos/:id/onboarding/generate → the confirmed generation (AC-6);
 *                                          no body beyond the repo reference.
 *
 * Both routes resolve tenancy via `getContext` first and 404 for a repo
 * outside the caller's workspace (AC-31) — the rule `blast/routes.ts:22-23`
 * and `project-context/routes.ts:19-21` already follow.
 */
export default async function onboardingRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new OnboardingService(app.container.onboardingRepo, app.container);

  app.get(
    '/repos/:id/onboarding',
    { schema: { params: IdParams } },
    async (req): Promise<OnboardingTourResponse> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.getTour(workspaceId, req.params.id);
    },
  );

  app.post(
    '/repos/:id/onboarding/generate',
    { schema: { params: IdParams } },
    async (req): Promise<OnboardingTourResponse> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.generate(workspaceId, req.params.id, req.log);
    },
  );
}
