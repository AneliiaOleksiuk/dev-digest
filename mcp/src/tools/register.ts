/**
 * MCP SDK 1.30 `registerTool` generics + zod 3.25 shapes explode tsc
 * (TS2589 / heap OOM). Keep runtime identical; erase the generic surface.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

type ToolConfig = {
  description: string;
  inputSchema: object;
  outputSchema: object;
  annotations?: object;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ToolHandler = (...args: any[]) => CallToolResult | Promise<CallToolResult>;

export function registerTool(server: McpServer, name: string, config: ToolConfig, handler: ToolHandler): void {
  (server.registerTool as (n: string, c: ToolConfig, h: ToolHandler) => void)(name, config, handler);
}
