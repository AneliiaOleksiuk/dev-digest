import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { EvalCaseFromFindingInput, EvalCaseInput } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { EvalService } from './service.js';

/**
 * Eval module (Phase B — case CRUD + create-from-finding; the batch runner
 * and read APIs are Phase C, WI7/WI8).
 *
 *   GET    /agents/:id/eval-cases  → an agent's eval cases (workspace-scoped)
 *   GET    /eval-cases/:id         → one case (degrades on a corrupt
 *                                    expected_output rather than throwing)
 *   POST   /eval-cases             → create (owner_kind restricted to 'agent'
 *                                    this iteration, D-9)
 *   PATCH  /eval-cases/:id         → partial update
 *   DELETE /eval-cases/:id         → delete
 *   POST   /findings/:id/eval-case → one-click "create case from finding"
 *                                    (WI5) — registered here, not
 *                                    `modules/reviews`, per this repo's
 *                                    existing "route prefix doesn't imply
 *                                    module ownership" precedent.
 */

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
}
