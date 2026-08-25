import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { RunRequest } from '@devdigest/shared';
import type { RunEvent } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { ReviewService } from './service.js';
import type { IntentLogSink } from './intent-service.js';
import { MAX_MULTI_AGENT_BATCH_SIZE } from './constants.js';

/** 3-line adapter over `req.log` — the manual `POST /pulls/:id/intent` route's
 *  version of `RunLogger`'s structural sink (which the background run path
 *  uses instead; both satisfy the same `IntentLogSink` shape). */
function intentLogSink(log: FastifyBaseLogger): IntentLogSink {
  return {
    info: (msg, data) => log.info(data !== undefined ? { data } : {}, msg),
    tool: (msg, data) => log.info(data !== undefined ? { data } : {}, msg),
    error: (msg, data) => log.error(data !== undefined ? { data } : {}, msg),
  };
}

/**
 * reviews module.
 *   POST   /pulls/:id/review  {agentId} | {all:true}  → run review(s); returns runs
 *   GET    /runs/:id/events                            → SSE stream of RunEvent (replay-first)
 *   GET    /runs/:id/trace                             → the single-document RunTrace
 *   GET    /pulls/:id/reviews                          → persisted reviews + findings for a PR
 *   POST   /findings/:id/(accept|dismiss|learn)        → finding actions
 *   (POST  /findings/:id/eval-case is owned by modules/eval/routes.ts, not here)
 *   POST   /pulls/:id/intent                           → force re-classify a PR's intent
 *   GET    /pulls/:id/intent                            → persisted intent, or `null`
 *   POST   /pulls/:id/multi-agent-run                   → L07: run an explicit agent subset as one batch
 *   GET    /multi-agent-runs/:id                        → L07: read a batch (columns + derived groups/conflicts)
 */
const FINDING_ACTIONS = ['accept', 'dismiss', 'learn'] as const;

/** Body of `POST /pulls/:id/multi-agent-run` — a non-empty, duplicate-free
 *  (enforced in the service, not here) set of workspace agent uuids, capped
 *  defensively at the route (see `MAX_MULTI_AGENT_BATCH_SIZE`'s docblock for
 *  why this differs from OQ-4's real business-rule cap). */
const MultiAgentRunBody = z.object({
  agent_ids: z.array(z.string().uuid()).min(1).max(MAX_MULTI_AGENT_BATCH_SIZE),
});
export default async function reviewsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new ReviewService(container);

  // ---- Run a review (manual trigger) -------------------------------
  // Tight per-route limit: each call can fan out to expensive LLM runs.
  // Body stays a tolerant manual parse (both fields optional; empty body is OK).
  app.post(
    '/pulls/:id/review',
    { schema: { params: IdParams }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
    const { workspaceId } = await getContext(container, req);
    const body = RunRequest.parse(req.body ?? {});
    const targets = await service.resolveTargets(workspaceId, {
      ...(body.agentId !== undefined ? { agentId: body.agentId } : {}),
      ...(body.all !== undefined ? { all: body.all } : {}),
    });
    const { runs, reviews } = await service.runReview(
      workspaceId,
      req.params.id,
      targets,
      req.log,
    );
    return { pr_id: req.params.id, runs, reviews };
  });

  // ---- Intent: force re-classify (manual trigger) --------------------------
  // Same rate limit + rationale as POST /pulls/:id/review: each call is a
  // paid LLM call. Rate limiting is globally disabled under NODE_ENV=test.
  app.post(
    '/pulls/:id/intent',
    { schema: { params: IdParams }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.intent.classifyForPr(workspaceId, req.params.id, intentLogSink(req.log));
    },
  );

  // ---- Intent: persisted record (200 + null body when not classified yet) --
  app.get('/pulls/:id/intent', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const record = await service.intent.getStoredIntent(workspaceId, req.params.id);
    return record ?? null;
  });

  // ---- SSE: live run events (replay buffer first, then live; ends on done) -
  // No rate limit: SSE is one long-lived connection, not burst traffic.
  app.get(
    '/runs/:id/events',
    { schema: { params: IdParams }, config: { rateLimit: false } },
    async (req, reply) => {
    await getContext(container, req);
    const runId = req.params.id;

    reply.sse(
      (async function* () {
        // Bridge the in-memory RunBus to an async iterator the SSE plugin drains.
        const queue: RunEvent[] = [];
        let resolve: (() => void) | null = null;
        let done = false;

        const unsubscribe = container.runBus.subscribe(runId, (e) => {
          queue.push(e);
          resolve?.();
        });
        const offDone = container.runBus.onDone(runId, () => {
          done = true;
          resolve?.();
        });

        try {
          while (true) {
            if (queue.length === 0) {
              if (done) break;
              await new Promise<void>((r) => (resolve = r));
              resolve = null;
              continue;
            }
            const e = queue.shift()!;
            yield {
              id: String(e.seq),
              event: e.kind,
              data: JSON.stringify(e),
            };
          }
        } finally {
          unsubscribe();
          offDone();
        }
      })(),
    );
  });

  // ---- Active (in-flight) runs for a PR (server source of truth) ----------
  app.get('/pulls/:id/runs/active', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.activeRuns(workspaceId, req.params.id);
  });

  // ---- All runs for a PR (any status; the run history, incl. failures) -----
  app.get('/pulls/:id/runs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.listRuns(workspaceId, req.params.id);
  });

  // ---- Delete one run from the history (+ its trace) ----------------------
  app.delete('/runs/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const ok = await service.deleteRun(workspaceId, req.params.id);
    return { ok };
  });

  // ---- Cancel an in-flight run --------------------------------------------
  app.post('/runs/:id/cancel', { schema: { params: IdParams } }, async (req) => {
    await getContext(container, req);
    await service.cancelRun(req.params.id);
    return { ok: true };
  });

  // ---- Run trace (single document; A5 enriches with multi-agent/stats) ----
  app.get('/runs/:id/trace', { schema: { params: IdParams } }, async (req) => {
    await getContext(container, req);
    const trace = await service.getRunTrace(req.params.id);
    if (!trace) throw new NotFoundError('Run trace not found');
    return trace;
  });

  // ---- Reads --------------------------------------------------------------
  app.get('/pulls/:id/reviews', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.reviewsForPull(workspaceId, req.params.id);
  });

  // ---- Delete a whole review run (one agent's pass) + its findings --------
  app.delete('/reviews/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const ok = await service.deleteReview(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Review not found');
    return { ok: true };
  });

  // ---- Finding actions (accept / dismiss / learn) -------------------------
  for (const action of FINDING_ACTIONS) {
    app.post(`/findings/:id/${action}`, { schema: { params: IdParams } }, async (req) => {
      const { workspaceId } = await getContext(container, req);
      const result = await service.actOnFinding(workspaceId, req.params.id, action);
      return result;
    });
  }

  // ---- "Turn into eval case" is NOT registered here. `modules/eval/routes.ts`
  // owns `POST /findings/:id/eval-case` (merged in from L06-Evals, main) — its
  // `createFromFinding` is the fuller-featured implementation (derives the
  // eval expectation from the finding's own accept/dismiss verdict, refuses
  // with 422 on an undecided finding rather than guessing) and was built with
  // explicit awareness of this exact route ("registered here, not
  // modules/reviews, per this repo's route-prefix-doesn't-imply-module-
  // ownership precedent" — see its own routes.ts doc comment). SPEC-04's own
  // `eval-case.ts` service in this module is superseded by it, not a
  // duplicate to keep registered alongside it — see server/INSIGHTS.md.

  // ---- Multi-agent batch review (L07, SPEC-04) ----------------------------
  // Tight per-route limit, at least as strict as POST /pulls/:id/review
  // above — each call fans out to N expensive LLM runs, not just one.
  app.post(
    '/pulls/:id/multi-agent-run',
    {
      schema: { params: IdParams, body: MultiAgentRunBody },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.multiAgent.runBatch(workspaceId, req.params.id, req.body.agent_ids, req.log);
    },
  );

  // ---- Multi-agent batch read — workspace-scoped; a foreign id 404s -------
  app.get('/multi-agent-runs/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.multiAgentRead.getBatch(workspaceId, req.params.id);
  });
}
