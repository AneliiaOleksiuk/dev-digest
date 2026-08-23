import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { OpenRouterProvider } from '@devdigest/reviewer-core';
import type { LLMProvider } from '@devdigest/shared';

/** Same path `server/src/platform/config.ts` computes for `secretsPath`. */
export const DEFAULT_SECRETS_PATH = join(homedir(), '.devdigest', 'secrets.json');

/**
 * Missing/unreadable/malformed key → a clean, actionable message + (via the
 * CLI) exit 2 — never a stack trace, never an echoed key.
 */
export class MissingApiKeyError extends Error {
  constructor() {
    super(
      'No OpenRouter API key found. Set one via the DevDigest web UI (Settings → Secrets — ' +
        `writes to ${DEFAULT_SECRETS_PATH}) or export OPENROUTER_API_KEY in your shell, then retry.`,
    );
    this.name = 'MissingApiKeyError';
  }
}

/**
 * Reads `~/.devdigest/secrets.json` directly — mirrors `LocalSecretsProvider`'s
 * stored-value-wins-over-env precedence WITHOUT importing it (this package
 * never imports `server/src`, per `mcp/AGENTS.md`). Missing/unreadable file →
 * no stored override, same as the server's own fallback behaviour.
 */
async function readStoredKey(secretsPath: string): Promise<string | undefined> {
  try {
    const raw = await readFile(secretsPath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const value = (parsed as Record<string, unknown>).OPENROUTER_API_KEY;
      if (typeof value === 'string' && value) return value;
    }
  } catch {
    // Missing or unreadable file → no stored override; fall through to env.
  }
  return undefined;
}

/**
 * Resolves the OpenRouter API key (stored file wins over `process.env`,
 * mirroring `LocalSecretsProvider`) and constructs an `OpenRouterProvider`
 * from `@devdigest/reviewer-core` — the SAME provider class the server uses.
 * Throws `MissingApiKeyError` when no key is available anywhere.
 */
export async function resolveLlm(
  secretsPath: string = DEFAULT_SECRETS_PATH,
  env: NodeJS.ProcessEnv = process.env,
): Promise<LLMProvider> {
  const stored = await readStoredKey(secretsPath);
  const key = stored ?? env.OPENROUTER_API_KEY;
  if (!key) throw new MissingApiKeyError();
  return new OpenRouterProvider(key);
}
