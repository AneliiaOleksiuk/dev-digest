import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './server.js';

/**
 * The only file in this package that touches stdio. stdout is the MCP
 * protocol channel — nothing may write to it. All diagnostics go to stderr
 * (`console.error`), never `console.log`. See mcp/README.md.
 */
async function main(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  console.error('[devdigest-mcp] fatal error starting the server:', err);
  process.exit(1);
});
