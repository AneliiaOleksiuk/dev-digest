import { describe, expect, it } from 'vitest';
import { listAgentsHandler } from '../src/tools/list-agents.js';
import { ListAgentsOutputSchema } from '../src/schemas.js';
import { createFakeApi } from './fake-api.js';
import { makeAgent } from './fixtures.js';

describe('list_agents', () => {
  it('maps Agent[] to AgentSummary[] and drops system_prompt', async () => {
    const api = createFakeApi({
      get: (path) => {
        if (path === '/agents') return [makeAgent(), makeAgent({ id: 'agent-2', name: 'Style Bot' })];
        throw new Error(`unexpected GET ${path}`);
      },
    });

    const result = await listAgentsHandler(api);

    expect(result.isError).toBeUndefined();
    const structured = ListAgentsOutputSchema.parse(result.structuredContent);
    expect(structured.agents).toHaveLength(2);
    expect(structured.agents[0]).toEqual({
      id: 'agent-1',
      name: 'Security Reviewer',
      description: 'Reviews PRs for security issues.',
      model: 'gpt-4.1',
    });
    // Every dropped field per WI3's Outputs table must not survive.
    for (const agent of structured.agents) {
      expect(agent).not.toHaveProperty('system_prompt');
      expect(agent).not.toHaveProperty('output_schema');
      expect(agent).not.toHaveProperty('version');
      expect(agent).not.toHaveProperty('strategy');
      expect(agent).not.toHaveProperty('ci_fail_on');
      expect(agent).not.toHaveProperty('repo_intel');
      expect(agent).not.toHaveProperty('provider');
    }
  });
});
