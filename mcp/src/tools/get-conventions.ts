import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ConventionCandidate } from '@devdigest/shared';
import type { ApiClient } from '../api-client.js';
import { apiFailureToolError, buildResult } from '../errors.js';
import { toConventionSummary } from '../project.js';
import { resolveRepo } from '../resolve.js';
import {
  GetConventionsInputShape,
  GetConventionsOutputSchema,
  GetConventionsOutputShape,
  type GetConventionsInput,
} from '../schemas.js';
import { registerTool } from './register.js';

const DESCRIPTION =
  "Get this repository's extracted coding conventions — the same house rules used to ground agent reviews.";

const EMPTY_NOTE =
  'No conventions have been extracted for this repo yet. Run "Extract conventions" in the web UI (Conventions tab) to generate them.';

export async function getConventionsHandler(
  api: ApiClient,
  input: GetConventionsInput,
): Promise<CallToolResult> {
  const repoResolved = await resolveRepo(api, input.repo);
  if (!repoResolved.ok) return repoResolved.result;
  const repo = repoResolved.value;

  let candidates: ConventionCandidate[];
  try {
    candidates = await api.get<ConventionCandidate[]>(`/repos/${repo.id}/conventions`);
  } catch (err) {
    return apiFailureToolError(err, api.baseUrl);
  }

  const conventions = candidates.map(toConventionSummary);
  return buildResult(
    GetConventionsOutputSchema,
    { conventions, ...(conventions.length === 0 ? { note: EMPTY_NOTE } : {}) },
    (structured) =>
      structured.conventions.length > 0
        ? `${structured.conventions.length} convention(s) found for ${repo.full_name}.`
        : EMPTY_NOTE,
  );
}

export function registerGetConventions(server: McpServer, api: ApiClient): void {
  registerTool(
    server,
    'get_conventions',
    {
      description: DESCRIPTION,
      inputSchema: GetConventionsInputShape,
      outputSchema: GetConventionsOutputShape,
      annotations: { title: "Get a repo's conventions", readOnlyHint: true, openWorldHint: false },
    },
    (input) => getConventionsHandler(api, input as GetConventionsInput),
  );
}
