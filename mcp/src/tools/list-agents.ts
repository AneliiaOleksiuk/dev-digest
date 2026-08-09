import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Agent } from '@devdigest/shared';
import type { ApiClient } from '../api-client.js';
import { apiFailureToolError, buildResult } from '../errors.js';
import { toAgentSummary } from '../project.js';
import { ListAgentsInputShape, ListAgentsOutputSchema, ListAgentsOutputShape } from '../schemas.js';

const DESCRIPTION =
  "List the reviewer agents configured in this DevDigest workspace. Returns each agent's id, name, description, and model — the id is required by run_agent_on_pr and get_findings.";

export async function listAgentsHandler(api: ApiClient): Promise<CallToolResult> {
  let agents: Agent[];
  try {
    agents = await api.get<Agent[]>('/agents');
  } catch (err) {
    return apiFailureToolError(err, api.baseUrl);
  }

  return buildResult(
    ListAgentsOutputSchema,
    { agents: agents.map(toAgentSummary) },
    (structured) => `${structured.agents.length} agent(s) available.`,
  );
}

export function registerListAgents(server: McpServer, api: ApiClient): void {
  server.registerTool(
    'list_agents',
    {
      description: DESCRIPTION,
      inputSchema: ListAgentsInputShape,
      outputSchema: ListAgentsOutputShape,
      annotations: { title: 'List reviewer agents', readOnlyHint: true, openWorldHint: false },
    },
    () => listAgentsHandler(api),
  );
}
