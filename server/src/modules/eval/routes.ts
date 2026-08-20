import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { EvalCaseFromFindingInput, EvalCaseInput } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { EVAL_RUN_RATE_LIMIT } from './constants.js';
import { EvalService } from './service.js';

/**
 * Eval module.
 *
 *   GET    /agents/:id/eval-cases     → an agent's eval cases (workspace-scoped)
 *   GET    /eval-cases/:id            → one case (degrades on a corrupt
 *                                       expected_output rather than throwing)
 *   POST   /eval-cases                → create (owner_kind restricted to
 *                                       'agent' this iteration, D-9)
 *   PATCH  /eval-cases/:id            → partial update
 *   DELETE /eval-cases/:id            → delete
 *   POST   /findings/:id/eval-case    → one-click "create case from finding"
 *                                       (WI5) — registered here, not
 *                                       `modules/reviews`, per this repo's
 *                                       existing "route prefix doesn't imply
 *                                       module ownership" precedent.
 *   POST   /agents/:id/eval-runs      → run an agent's WHOLE case set as one
 *                                       version-pinned batch (WI7, rate-limited)
 *   POST   /eval-cases/:id/run        → run ONE case as a one-case batch
 *                                       (WI7, rate-limited)
 *   GET    /agents/:id/eval-dashboard → per-agent dashboard (WI8, zero LLM calls)
 *   GET    /eval-dashboard            → workspace-wide, one entry per agent (WI8)
 *   GET    /agents/:id/eval-batches   → an agent's batch history (WI8)
 *   GET    /eval-batches/:id          → one batch + its per-case runs (WI8)
 *   GET    /agents/:id/eval-compare   → two batches side by side, read-only (WI8)
 */

/** Querystring for `GET /agents/:id/eval-compare` (WI8). */
const EvalCompareQuery = z.object({ base: z.string().uuid(), head: z.string().uuid() });

/** D-9 — `owner_kind` accepted only as the literal `'agent'` at the API
 *  level this iteration, even though the Phase-A contract's enum still
 *  carries `'skill'` too. */
const EvalCaseCreateBody = EvalCaseInput.extend({ owner_kind: z.literal('agent') });

/** PATCH body — every field of the create body optional. */
const EvalCaseUpdateBody = EvalCaseCreateBody.partial();

export default async function evalRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new EvalService(app.container.evalRepo, app.container);

  app.get('/agents/:id/eval-cases', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.listForAgent(workspaceId, req.params.id);
  });

  app.get('/eval-cases/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const evalCase = await service.getById(workspaceId, req.params.id);
    if (!evalCase) throw new NotFoundError('Eval case not found');
    return evalCase;
  });

  app.post(
    '/eval-cases',
    { schema: { body: EvalCaseCreateBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const evalCase = await service.create(workspaceId, req.body);
      reply.status(201);
      return evalCase;
    },
  );

  app.patch(
    '/eval-cases/:id',
    { schema: { params: IdParams, body: EvalCaseUpdateBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const evalCase = await service.update(workspaceId, req.params.id, req.body);
      if (!evalCase) throw new NotFoundError('Eval case not found');
      return evalCase;
    },
  );

  app.delete('/eval-cases/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const ok = await service.delete(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Eval case not found');
    return { ok: true };
  });

  app.post(
    '/findings/:id/eval-case',
    { schema: { params: IdParams, body: EvalCaseFromFindingInput } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const evalCase = await service.createFromFinding(workspaceId, req.params.id, req.body.name);
      reply.status(201);
      return evalCase;
    },
  );

  // ---- WI7: batch runner (rate-limited — each call can trigger paid LLM
  // calls, same rationale as `modules/reviews/routes.ts:41-44,62-66`) -------

  app.post(
    '/agents/:id/eval-runs',
    { schema: { params: IdParams }, config: { rateLimit: EVAL_RUN_RATE_LIMIT } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const batch = await service.runForAgent(workspaceId, req.params.id, req.log);
      reply.status(201);
      return batch;
    },
  );

  app.post(
    '/eval-cases/:id/run',
    { schema: { params: IdParams }, config: { rateLimit: EVAL_RUN_RATE_LIMIT } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const batch = await service.runOneCase(workspaceId, req.params.id, req.log);
      reply.status(201);
      return batch;
    },
  );

  // ---- WI8: read APIs — dashboard, history, compare (zero LLM calls) ------

  app.get('/agents/:id/eval-dashboard', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.getDashboardForAgent(workspaceId, req.params.id);
  });

  app.get('/eval-dashboard', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.getWorkspaceDashboard(workspaceId);
  });

  app.get('/agents/:id/eval-batches', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.listBatchesForAgent(workspaceId, req.params.id);
  });

  app.get('/eval-batches/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const detail = await service.getBatch(workspaceId, req.params.id);
    if (!detail) throw new NotFoundError('Eval batch not found');
    return detail;
  });

  app.get(
    '/agents/:id/eval-compare',
    { schema: { params: IdParams, querystring: EvalCompareQuery } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.compare(workspaceId, req.params.id, req.query.base, req.query.head);
    },
  );
}
