import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { BriefResponse, BriefTimelineResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BRIEF_RATE_LIMIT } from './constants.js';
import { BriefService, type BriefLogSink } from './service.js';

/** 3-line adapter over `req.log` — same shape as `reviews/routes.ts`'s
 *  `intentLogSink`. */
function briefLogSink(log: FastifyBaseLogger): BriefLogSink {
  return {
    info: (msg, data) => log.info(data !== undefined ? { data } : {}, msg),
  };
}

const GenerateBriefBody = z.object({
  head_sha: z.string(),
  force: z.boolean().optional(),
});

/**
 * Brief module (SPEC-03).
 *   GET  /pulls/:id/brief            → the persisted brief for the PR's
 *                                       current head_sha, or an honest
 *                                       absent/stale/corrupt state — NEVER a
 *                                       model call.
 *   POST /pulls/:id/brief/generate   → the confirmed (re)generation
 *                                       (AC-3/AC-13); rate-limited like the
 *                                       other model-spending PR routes.
 *   GET  /pulls/:id/brief/timeline   → every persisted brief for the PR,
 *                                       newest first — NEVER a model call.
 *
 * Every handler resolves tenancy via `getContext` first and 404s for a PR
 * outside the caller's workspace (AC-36) — the `blast/routes.ts:22-23`
 * barrier, applied to all three routes including the list route (an
 * authorization check that skips the list route would be a textbook IDOR).
 */
export default async function briefRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new BriefService(app.container.briefRepo, app.container.briefSources, app.container);

  app.get(
    '/pulls/:id/brief',
    { schema: { params: IdParams } },
    async (req): Promise<BriefResponse> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.getBrief(workspaceId, req.params.id);
    },
  );

  app.post(
    '/pulls/:id/brief/generate',
    { schema: { params: IdParams, body: GenerateBriefBody }, config: { rateLimit: BRIEF_RATE_LIMIT } },
    async (req): Promise<BriefResponse> => {
      const { workspaceId } = await getContext(app.container, req);
      const { head_sha, force } = req.body;
      return service.generate(workspaceId, req.params.id, { headSha: head_sha, force }, briefLogSink(req.log));
    },
  );

  app.get(
    '/pulls/:id/brief/timeline',
    { schema: { params: IdParams } },
    async (req): Promise<BriefTimelineResponse> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.getTimeline(workspaceId, req.params.id);
    },
  );
}
