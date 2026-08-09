import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createMcpServer } from '../src/server.js';

/**
 * Full round-trip over the real MCP protocol (via an in-memory transport
 * pair) rather than calling handler functions directly — this is the one
 * place that proves `list_tools` really returns exactly 5 tools wired
 * through `registerTool`, not just that 5 files exist.
 */
async function connectedClient() {
  const server = createMcpServer('http://localhost:3001');
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { server, client };
}

describe('createMcpServer', () => {
  it('registers exactly 5 tools', async () => {
    const { client } = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(5);
    expect(tools.map((t) => t.name).sort()).toEqual(
      ['get_blast_radius', 'get_conventions', 'get_findings', 'list_agents', 'run_agent_on_pr'].sort(),
    );
  });

  it('get_blast_radius is listed and errors with a "not implemented" message', async () => {
    const { client } = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === 'get_blast_radius')).toBeDefined();

    const result = await client.callTool({
      name: 'get_blast_radius',
      arguments: { repo: 'acme/widgets-api', pr: 1 },
    });
    expect(result.isError).toBe(true);
  });
});
