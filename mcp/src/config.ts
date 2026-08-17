/**
 * Centralizes env-var config reads for this package. Read fresh on every
 * call (not memoized) so tests can mutate process.env between cases without
 * re-importing the module — same behavior the code being replaced relied on.
 * An unset variable silently uses its default; a SET-but-invalid variable
 * throws `ConfigError` instead of being swallowed into a default.
 */

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export const DEFAULT_API_BASE = 'http://localhost:3001';
export const DEFAULT_RUN_TIMEOUT_MS = 180_000;

/** @param env Injectable for tests — avoids global `process.env` stubbing. */
export function getApiBase(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.DEVDIGEST_API_BASE;
  if (raw === undefined) return DEFAULT_API_BASE;
  try {
    new URL(raw);
  } catch {
    throw new ConfigError(`DEVDIGEST_API_BASE must be a valid URL, got "${raw}".`);
  }
  return raw;
}

/** @param env Injectable for tests — avoids global `process.env` stubbing. */
export function getRunTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.DEVDIGEST_MCP_RUN_TIMEOUT_MS;
  if (raw === undefined) return DEFAULT_RUN_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ConfigError(`DEVDIGEST_MCP_RUN_TIMEOUT_MS must be a positive number, got "${raw}".`);
  }
  return parsed;
}
