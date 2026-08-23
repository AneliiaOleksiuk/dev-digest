import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { BlastRadiusResponse } from '@devdigest/shared';
import type { ApiClient } from '../api-client.js';
import { apiFailureToolError, buildResult } from '../errors.js';
import { toBlastRadiusOutput } from '../project.js';
import { resolvePr, resolveRepo } from '../resolve.js';
import {
  GetBlastRadiusInputShape,
  GetBlastRadiusOutputSchema,
  GetBlastRadiusOutputShape,
  type GetBlastRadiusInput,
} from '../schemas.js';
import { registerTool } from './register.js';

const DESCRIPTION =
  "Get the blast radius (impact map) of a pull request's changes: symbols declared in the changed files, their direct callers, and the endpoints/cron jobs those callers reach. Read entirely from the repo's existing code index — never from a model.";

/**
 * Pure HTTP façade (WI7) — same design as the other 4 tools: no in-process
 * engine import, no secrets, no LLM call. Calls the new
 * `GET /pulls/:id/blast` route (docs/plans/l04-blast-radius-and-prepush-cli.md
 * WI2) via the injected `ApiClient`, resolves `repo`/`pr` via the existing
 * `resolve.ts` chain, and reports every failure through `apiFailureToolError`
 * — never a thrown protocol-level error.
 */
export async function getBlastRadiusHandler(
  api: ApiClient,
  input: GetBlastRadiusInput,
): Promise<CallToolResult> {
  const repoResolved = await resolveRepo(api, input.repo);
  if (!repoResolved.ok) return repoResolved.result;
  const repo = repoResolved.value;

  const prResolved = await resolvePr(api, repo, input.pr);
  if (!prResolved.ok) return prResolved.result;
  const pull = prResolved.value;

  let blast: BlastRadiusResponse;
  try {
    blast = await api.get<BlastRadiusResponse>(`/pulls/${pull.id}/blast`);
  } catch (err) {
    return apiFailureToolError(err, api.baseUrl);
  }

  return buildResult(GetBlastRadiusOutputSchema, toBlastRadiusOutput(blast), (structured) => structured.summary);
}

export function registerGetBlastRadius(server: McpServer, api: ApiClient): void {
  registerTool(
    server,
    'get_blast_radius',
    {
      description: DESCRIPTION,
      inputSchema: GetBlastRadiusInputShape,
      outputSchema: GetBlastRadiusOutputShape,
      // openWorldHint: true — resolving `pr` calls GET /repos/:id/pulls, which
      // syncs from GitHub (same reasoning as get_findings, docs/plans/mcp-server.md Risk 6).
      annotations: { title: 'Get blast radius', readOnlyHint: true, openWorldHint: true },
    },
    (input) => getBlastRadiusHandler(api, input as GetBlastRadiusInput),
  );
}
