import { readFile } from 'node:fs/promises';
import { AgentManifest } from '@devdigest/shared';
import type { AgentManifest as AgentManifestT } from '@devdigest/shared';

/**
 * Resolves the review-agent config the pre-push CLI runs with — no DB, no
 * `.devdigest/agents/<slug>.yaml` (nothing in this repo reads/writes that
 * form yet; see the plan's Open Q4/decision). A default is shipped as a
 * constant here; `--agent-file <path.json>` overrides it wholesale, parsed
 * against the SAME `AgentManifest` zod schema the studio/CI runner share
 * (JSON, not YAML — no new dependency).
 *
 * This is one of the deliberate, documented exceptions to the "every
 * `@devdigest/shared` import here is `import type`" convention (see
 * `mcp/AGENTS.md`) — the CLI needs the real schema to `.parse()` an
 * untrusted file, not just its inferred type. Scoped to `cli/*` only.
 */
export const DEFAULT_AGENT: AgentManifestT = {
  name: 'DevDigest Pre-push Reviewer',
  provider: 'openrouter',
  model: 'deepseek/deepseek-v4-flash',
  system_prompt:
    'You are a meticulous senior code reviewer. Review the provided diff for correctness bugs, ' +
    'security issues, and significant design problems. Be concise and specific; always cite the ' +
    "exact file and line(s) a finding applies to. Don't comment on formatting/style nits unless " +
    'they indicate a real bug.',
  skills: [],
  strategy: 'auto',
  ci_fail_on: 'critical',
};

export class InvalidAgentFileError extends Error {
  constructor(path: string, cause: string) {
    super(`Could not load agent config from ${path}: ${cause}`);
    this.name = 'InvalidAgentFileError';
  }
}

/**
 * Loads the review agent config. No `agentFilePath` → `DEFAULT_AGENT`.
 * Otherwise reads + JSON-parses the file and validates it against
 * `AgentManifest` — any failure (missing file, invalid JSON, schema
 * mismatch) throws `InvalidAgentFileError` with a clean, actionable message
 * (never a raw stack trace or a bare `ZodError`).
 */
export async function loadAgent(agentFilePath?: string): Promise<AgentManifestT> {
  if (!agentFilePath) return DEFAULT_AGENT;

  let raw: string;
  try {
    raw = await readFile(agentFilePath, 'utf8');
  } catch (err) {
    throw new InvalidAgentFileError(agentFilePath, (err as Error).message);
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new InvalidAgentFileError(agentFilePath, `invalid JSON — ${(err as Error).message}`);
  }

  const parsed = AgentManifest.safeParse(json);
  if (!parsed.success) {
    throw new InvalidAgentFileError(agentFilePath, parsed.error.message);
  }
  return parsed.data;
}
