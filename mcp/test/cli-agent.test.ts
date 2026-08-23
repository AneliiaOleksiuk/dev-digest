import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_AGENT, loadAgent, InvalidAgentFileError } from '../src/cli/agent.js';

describe('cli/agent — AgentManifest resolution', () => {
  it('no --agent-file -> the default agent', async () => {
    const agent = await loadAgent(undefined);
    expect(agent).toEqual(DEFAULT_AGENT);
  });

  it('a valid --agent-file overrides the default wholesale', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'devdigest-cli-agent-'));
    const file = join(dir, 'agent.json');
    try {
      await writeFile(
        file,
        JSON.stringify({
          name: 'Custom Reviewer',
          provider: 'openrouter',
          model: 'anthropic/claude-3-haiku',
          system_prompt: 'Be terse.',
          strategy: 'single-pass',
          ci_fail_on: 'any',
        }),
      );
      const agent = await loadAgent(file);
      expect(agent.name).toBe('Custom Reviewer');
      expect(agent.strategy).toBe('single-pass');
      expect(agent.ci_fail_on).toBe('any');
      expect(agent.skills).toEqual([]); // AgentManifest normalizes missing/null skills to []
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('a missing --agent-file path -> InvalidAgentFileError, not a raw ENOENT', async () => {
    await expect(loadAgent('/does/not/exist/agent.json')).rejects.toThrow(InvalidAgentFileError);
  });

  it('invalid JSON -> InvalidAgentFileError', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'devdigest-cli-agent-'));
    const file = join(dir, 'agent.json');
    try {
      await writeFile(file, '{ not valid json');
      await expect(loadAgent(file)).rejects.toThrow(InvalidAgentFileError);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('JSON that fails the AgentManifest schema -> InvalidAgentFileError', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'devdigest-cli-agent-'));
    const file = join(dir, 'agent.json');
    try {
      await writeFile(file, JSON.stringify({ name: 'Missing required fields' }));
      await expect(loadAgent(file)).rejects.toThrow(InvalidAgentFileError);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
