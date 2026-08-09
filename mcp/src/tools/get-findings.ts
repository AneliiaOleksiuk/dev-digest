import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ReviewRecord } from '@devdigest/shared';
import type { ApiClient } from '../api-client.js';
import { apiFailureToolError, buildResult, toolError } from '../errors.js';
import { toVerdictResult } from '../project.js';
import { resolveAgent, resolvePr, resolveRepo } from '../resolve.js';
import {
  GetFindingsInputShape,
  type GetFindingsInput,
  VerdictResultSchema,
  VerdictResultShape,
} from '../schemas.js';

const DESCRIPTION =
  'Get the verdict and findings from the most recent completed review of a pull request. Use after run_agent_on_pr, or to check a review someone else already ran.';

export async function getFindingsHandler(api: ApiClient, input: GetFindingsInput): Promise<CallToolResult> {
  const repoResolved = await resolveRepo(api, input.repo);
  if (!repoResolved.ok) return repoResolved.result;
  const repo = repoResolved.value;

  const prResolved = await resolvePr(api, repo, input.pr);
  if (!prResolved.ok) return prResolved.result;
  const pull = prResolved.value;

  let agentId: string | undefined;
  let agentName: string | undefined;
  if (input.agent !== undefined) {
    const agentResolved = await resolveAgent(api, input.agent);
    if (!agentResolved.ok) return agentResolved.result;
    agentId = agentResolved.value.id;
    agentName = agentResolved.value.name;
  }

  let reviews: ReviewRecord[];
  try {
    reviews = await api.get<ReviewRecord[]>(`/pulls/${pull.id}/reviews`);
  } catch (err) {
    return apiFailureToolError(err, api.baseUrl);
  }

  const candidates = reviews
    .filter((r) => r.kind === 'review')
    .filter(
      (r) =>
        agentId === undefined ||
        r.agent_id === agentId ||
        (agentName !== undefined && r.agent_name === agentName),
    )
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const latest = candidates[0];
  if (!latest) {
    const byAgent = agentName ? ` by ${agentName}` : '';
    return toolError(
      `No completed review for PR #${input.pr} in ${repo.full_name}${byAgent}. Call run_agent_on_pr(repo, pr, agent) first.`,
    );
  }

  return buildResult(VerdictResultSchema, toVerdictResult(latest), (structured) => structured.summary ?? '(no summary)');
}

export function registerGetFindings(server: McpServer, api: ApiClient): void {
  server.registerTool(
    'get_findings',
    {
      description: DESCRIPTION,
      inputSchema: GetFindingsInputShape,
      outputSchema: VerdictResultShape,
      // openWorldHint: true — resolving `pr` calls GET /repos/:id/pulls, which
      // syncs from GitHub (see docs/plans/mcp-server.md, Risk 6). Not a purely
      // local read, unlike get_conventions/list_agents.
      annotations: { title: 'Get review findings', readOnlyHint: true, openWorldHint: true },
    },
    (input) => getFindingsHandler(api, input),
  );
}
