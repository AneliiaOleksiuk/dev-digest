import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { CiExportInput } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { ValidationError } from '../../platform/errors.js';
import { parseRepoRef } from './helpers.js';
import { CiService } from './service.js';

/**
 * CI module (Phase B — generator half only).
 *
 *   POST /agents/:id/export-ci/preview → the exported file set, ZERO side
 *                                         effects (AC-2): no GitHub call, no
 *                                         DB write, no token minted. Install
 *                                         (`POST /agents/:id/export-ci`) is
 *                                         Phase C, not built here.
 */
export default async function ciRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new CiService(app.container.ciRepo, app.container);

  app.post(
    '/agents/:id/export-ci/preview',
    { schema: { params: IdParams, body: CiExportInput } },
    async (req) => {
      // AC-75 — resolve tenancy BEFORE anything else is read.
      const { workspaceId } = await getContext(app.container, req);

      // AC-3 — the contract keeps its full four-value `target` enum; only
      // 'gha' is ever accepted at the route.
      if (req.body.target !== 'gha') {
        throw new ValidationError(
          `Unsupported CI target: '${req.body.target}'. Only 'gha' (GitHub Actions) is available.`,
        );
      }

      // AC-4 — every downstream path/branch/commit derives from the PARSED
      // repo ref, never the raw string.
      const repoRef = parseRepoRef(req.body.repo);
      if (!repoRef) {
        throw new ValidationError('repo must be in the exact form "owner/name".');
      }

      const files = await service.generateFiles(workspaceId, req.params.id, req.body);

      // AC-74, A09 — repository, agent id, file count, outcome. NEVER file
      // contents, the system prompt, skill bodies or the request body.
      req.log.info(
        { repo: req.body.repo, agentId: req.params.id, fileCount: files.length, outcome: 'preview' },
        'ci export preview generated',
      );

      return { files };
    },
  );
}
