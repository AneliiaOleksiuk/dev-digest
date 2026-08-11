import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createApiClient } from './api-client.js';
import { registerGetBlastRadius } from './tools/get-blast-radius.js';
import { registerGetConventions } from './tools/get-conventions.js';
import { registerGetFindings } from './tools/get-findings.js';
import { registerListAgents } from './tools/list-agents.js';
import { registerRunAgentOnPr } from './tools/run-agent-on-pr.js';

/**
 * Builds the MCP server and registers all five tools (WI1/WI3–WI7). Pure
 * wiring — no transport concerns here, see `index.ts` for the stdio connect.
 */
export function createMcpServer(apiBaseUrl?: string): McpServer {
  const api = createApiClient(apiBaseUrl);
  const server = new McpServer({ name: '@devdigest/mcp', version: '0.0.0' });

  registerListAgents(server, api);
  registerRunAgentOnPr(server, api);
  registerGetFindings(server, api);
  registerGetConventions(server, api);
  registerGetBlastRadius(server, api);

  return server;
}
