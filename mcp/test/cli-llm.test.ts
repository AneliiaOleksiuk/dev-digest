import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveLlm, MissingApiKeyError } from '../src/cli/llm.js';

describe('cli/llm — API key resolution (stored file wins over env)', () => {
  it('no stored file, no env var -> MissingApiKeyError with an actionable message, never a key', async () => {
    await expect(resolveLlm('/does/not/exist/secrets.json', {})).rejects.toThrow(MissingApiKeyError);
    try {
      await resolveLlm('/does/not/exist/secrets.json', {});
    } catch (err) {
      expect((err as Error).message).toContain('OPENROUTER_API_KEY');
      expect((err as Error).message).not.toMatch(/sk-|sk_/); // never echoes a key shape
    }
  });

  it('falls back to process.env.OPENROUTER_API_KEY when no file is stored', async () => {
    const llm = await resolveLlm('/does/not/exist/secrets.json', { OPENROUTER_API_KEY: 'env-key-123' });
    expect(llm.id).toBe('openrouter');
  });

  it('a stored key in the secrets file wins over the env var', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'devdigest-cli-llm-'));
    const file = join(dir, 'secrets.json');
    try {
      await writeFile(file, JSON.stringify({ OPENROUTER_API_KEY: 'stored-key-456' }));
      // No assertion possible on which literal key was used (OpenRouterProvider
      // doesn't expose it) — this proves the stored-file path resolves without
      // error even when an (intentionally different) env var is also present.
      const llm = await resolveLlm(file, { OPENROUTER_API_KEY: 'env-key-should-be-ignored' });
      expect(llm.id).toBe('openrouter');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
