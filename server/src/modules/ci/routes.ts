import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { CiExportInput, CiRunFilters } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { EXPORT_RATE_LIMIT, INGEST_RATE_LIMIT, MAX_INGEST_BODY_BYTES } from './constants.js';
import { parseRepoRef } from './helpers.js';
import { CiService } from './service.js';

/**
 * CI module (Phase C — Install, ingest, read APIs; Preview is Phase B).
 *
 *   POST   /agents/:id/export-ci/preview   → generated file set, ZERO side
 *                                             effects (Phase B, unchanged).
 *   POST   /agents/:id/export-ci           → Install AND "Update CI config"
 *                                             (AC-45, same route) — commits
 *                                             to `devdigest/ci`, opens/reuses
 *                                             a PR, mints a token on create.
 *   POST   /agents/:id/export-ci/zip       → identical file set as a zip,
 *                                             zero GitHub writes, no
 *                                             installation, no token (AC-37).
 *   POST   /ci/ingest                      → the module's ONE result-
 *                                             accepting route (AC-49);
 *                                             authenticated by a single
 *                                             `Authorization: Bearer <token>`
 *                                             header — the exact shape the
 *                                             generated workflow's reporting
 *                                             step sends (`workflow.ts`) —
 *                                             NOT by session (`getContext`
 *                                             is never called here, AC-52).
 *                                             Fix (finding 1): this used to
 *                                             read two custom headers
 *                                             (`x-devdigest-installation` /
 *                                             `x-devdigest-token`) that the
 *                                             generator never emitted, so
 *                                             the ingest path could never
 *                                             authenticate in production.
 *   GET    /ci/runs                        → workspace's CI runs (`source
 *                                             ='ci'` only), filterable.
 *   GET    /agents/:id/ci-installations    → an agent's installations.
 *   DELETE /ci/installations/:id           → Q-6's documented remedy.
 */

/** `req.headers[...]` values are `string | string[] | undefined` (a header
 *  MAY repeat) — only ever the first occurrence is meaningful here. */
function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Shared route-level validation for both export-producing routes (Preview
 *  already does this identically) — `target` is pinned to `'gha'` (AC-3) and
 *  `repo` must parse as a strict `owner/name` ref (AC-4) before ANYTHING
 *  else runs. Throws, never returns a sentinel, so a caller can't forget to
 *  check a return value. */
function assertGhaTarget(target: string): void {
  if (target !== 'gha') {
    throw new ValidationError(
      `Unsupported CI target: '${target}'. Only 'gha' (GitHub Actions) is available.`,
    );
  }
}

export default async function ciRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new CiService(app.container.ciRepo, app.container);

  app.post(
    '/agents/:id/export-ci/preview',
    { schema: { params: IdParams, body: CiExportInput } },
    async (req) => {
      // AC-75 — resolve tenancy BEFORE anything else is read.
      const { workspaceId } = await getContext(app.container, req);

      assertGhaTarget(req.body.target);

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

  // ---- WI13: Install / "Update CI config" (rate-limited — mints a real
  // secret and writes to a repository DevDigest does not own) --------------
  app.post(
    '/agents/:id/export-ci',
    { schema: { params: IdParams, body: CiExportInput }, config: { rateLimit: EXPORT_RATE_LIMIT } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      assertGhaTarget(req.body.target);
      const repoRef = parseRepoRef(req.body.repo);
      if (!repoRef) {
        throw new ValidationError('repo must be in the exact form "owner/name".');
      }
      return service.install(workspaceId, req.params.id, repoRef, req.body, req.log);
    },
  );

  // ---- WI13: "Copy files as a zip" — same validation, zero GitHub writes,
  // no installation, no token (AC-37, flagged decision — see service.ts) ---
  app.post(
    '/agents/:id/export-ci/zip',
    { schema: { params: IdParams, body: CiExportInput }, config: { rateLimit: EXPORT_RATE_LIMIT } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      assertGhaTarget(req.body.target);
      if (!parseRepoRef(req.body.repo)) {
        throw new ValidationError('repo must be in the exact form "owner/name".');
      }
      const buffer = await service.exportZip(workspaceId, req.params.id, req.body);
      req.log.info(
        { repo: req.body.repo, agentId: req.params.id, outcome: 'zip' },
        'ci export zip generated',
      );
      reply.header('Content-Type', 'application/zip');
      reply.header('Content-Disposition', 'attachment; filename="devdigest-ci.zip"');
      return reply.send(buffer);
    },
  );

  // ---- WI14: Ingest — the ONE result-accepting route in this module ------
  //
  // Deliberately NOT declared with `schema: { body: CiIngestInput }` even
  // though every other route in this codebase validates its body via the
  // zod type provider (server/AGENTS.md's usual convention) — automatic
  // schema validation runs BEFORE the handler, which would validate an
  // UNAUTHENTICATED caller's body before the header credential check below
  // ever runs. The Spec's flowchart is binding on this exact ordering
  // (header check → 401, writes nothing → THEN zod-validate the body,
  // AC-51/AC-53) — `CiService.ingest` performs the zod parse itself, AFTER
  // the auth check, so an unauthenticated caller learns nothing about
  // whether their body would even have been well-formed.
  app.post(
    '/ci/ingest',
    { config: { rateLimit: INGEST_RATE_LIMIT }, bodyLimit: MAX_INGEST_BODY_BYTES },
    async (req, reply) => {
      // Fix (finding 1) — a single `Authorization: Bearer <token>` header,
      // matching what the generated workflow's reporting step actually
      // sends (`workflow.ts`). `service.ingest` parses the `Bearer` scheme
      // and hashes/looks up the token itself.
      const authorizationHeader = firstHeaderValue(req.headers['authorization']);
      await service.ingest(authorizationHeader, req.body, req.log);
      reply.status(201);
      return { ok: true };
    },
  );

  // ---- WI15: read APIs (zero GitHub calls, zero LLM calls) ----------------

  app.get('/ci/runs', { schema: { querystring: CiRunFilters } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.listRuns(workspaceId, req.query);
  });

  app.get('/agents/:id/ci-installations', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.listInstallations(workspaceId, req.params.id);
  });

  // ---- WI16: Q-6's documented remedy (not demanded by any AC) -------------

  app.delete('/ci/installations/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const ok = await service.deleteInstallation(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('CI installation not found');
    return { ok: true };
  });
}
