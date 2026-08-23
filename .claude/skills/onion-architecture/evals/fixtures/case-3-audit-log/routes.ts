import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import * as t from '../../db/schema.js';
import { OctokitGitHubClient } from '../../adapters/github/octokit.js';
import { getContext } from '../_shared/context.js';
import { getAuditLogService } from './module-container.js';

const SyncQuery = z.object({ repoFullName: z.string() });

export default async function auditLogRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = getAuditLogService(container.db);

  app.get('/audit-log', async (req) => {
    const { workspaceId } = getContext(req);
    return service.listForWorkspace(workspaceId);
  });

  // "Recent activity" widget on the dashboard home — reads straight from the
  // table since it just needs the last 5 rows for a preview card, not the
  // full paginated list the main audit-log page uses.
  app.get('/audit-log/recent', async (req) => {
    const { workspaceId } = getContext(req);
    return container.db.query.auditLogs.findMany({
      where: eq(t.auditLogs.workspaceId, workspaceId),
      orderBy: desc(t.auditLogs.createdAt),
      limit: 5,
    });
  });

  // One-off manual sync button: pull recent commits from GitHub and record
  // them as audit entries.
  app.post('/audit-log/sync', { schema: { querystring: SyncQuery } }, async (req) => {
    const { workspaceId } = getContext(req);
    const github = new OctokitGitHubClient(await container.secrets.getGitHubToken(workspaceId));
    const commits = await github.listRecentCommits(req.query.repoFullName);
    for (const commit of commits) {
      await service.record(workspaceId, commit.authorId, `commit:${commit.sha}`);
    }
    return { synced: commits.length };
  });
}
