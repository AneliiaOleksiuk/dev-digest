import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { CreateContextDocumentBody, SaveContextDocumentBody, SetContextBody } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { ProjectContextService } from './service.js';

/**
 * Project Context module (SPEC-01 + AC-29–AC-53 amendment).
 *   GET  /repos/:id/context              → discovered documents (AC-1, AC-3)
 *   GET  /repos/:id/context/document     → read-only preview content + a
 *                                           staleness token (AC-4, AC-37)
 *   PUT  /repos/:id/context/document     → save an EXISTING document
 *                                           (AC-34–AC-40)
 *   POST /repos/:id/context/document     → create a NEW document
 *                                           (AC-41–AC-47)
 *   GET  /skills/:id/context             → a skill's own attached set (AC-9)
 *   POST /skills/:id/context             → replace a skill's attached set
 *   GET  /agents/:id/context             → an agent's own attached set (AC-10)
 *   POST /agents/:id/context             → replace an agent's attached set
 *
 * Every route resolves `getContext(...)` first and 404s (not 200-with-empty)
 * when the addressed repo/skill/agent doesn't belong to the caller's
 * workspace (A01) — including the two write routes above (AC-48), so a
 * cross-workspace repo 404s before any filesystem touch.
 */

const DocumentQuery = z.object({ path: z.string().min(1) });

const RepoScopeQuery = z.object({ repo_id: z.string().uuid() });

export default async function projectContextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ProjectContextService(app.container.contextRepo, app.container);

  app.get('/repos/:id/context', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.listDocuments(workspaceId, req.params.id);
  });

  app.get(
    '/repos/:id/context/document',
    { schema: { params: IdParams, querystring: DocumentQuery } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const doc = await service.getDocumentContent(workspaceId, req.params.id, req.query.path);
      if (!doc) throw new NotFoundError('Document not found');
      return doc;
    },
  );

  app.put(
    '/repos/:id/context/document',
    { schema: { params: IdParams, body: SaveContextDocumentBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const { path, content, revision } = req.body;
      return service.saveDocument(workspaceId, req.params.id, { path, content, revision }, req.log);
    },
  );

  app.post(
    '/repos/:id/context/document',
    { schema: { params: IdParams, body: CreateContextDocumentBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const { path, content } = req.body;
      return service.createDocument(workspaceId, req.params.id, { path, content }, req.log);
    },
  );

  app.get(
    '/skills/:id/context',
    { schema: { params: IdParams, querystring: RepoScopeQuery } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await app.container.skillsRepo.getById(workspaceId, req.params.id);
      if (!skill) throw new NotFoundError('Skill not found');
      return service.listAttachments(workspaceId, 'skill', req.params.id, req.query.repo_id);
    },
  );

  app.post(
    '/skills/:id/context',
    { schema: { params: IdParams, body: SetContextBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await app.container.skillsRepo.getById(workspaceId, req.params.id);
      if (!skill) throw new NotFoundError('Skill not found');
      return service.setAttachments(
        workspaceId,
        'skill',
        req.params.id,
        req.body.repo_id,
        req.body.paths,
      );
    },
  );

  app.get(
    '/agents/:id/context',
    { schema: { params: IdParams, querystring: RepoScopeQuery } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const agent = await app.container.agentsRepo.getById(workspaceId, req.params.id);
      if (!agent) throw new NotFoundError('Agent not found');
      return service.listAttachments(workspaceId, 'agent', req.params.id, req.query.repo_id);
    },
  );

  app.post(
    '/agents/:id/context',
    { schema: { params: IdParams, body: SetContextBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const agent = await app.container.agentsRepo.getById(workspaceId, req.params.id);
      if (!agent) throw new NotFoundError('Agent not found');
      return service.setAttachments(
        workspaceId,
        'agent',
        req.params.id,
        req.body.repo_id,
        req.body.paths,
      );
    },
  );
}
