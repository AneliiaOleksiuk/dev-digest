import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Agent, PrMeta, Repo } from '@devdigest/shared';
import type { ApiClient } from './api-client.js';
import { apiFailureToolError, toolError } from './errors.js';

/**
 * Shared `repo` → `pr` → `agent` resolution chain used by `run_agent_on_pr`
 * and `get_findings` (WI4/WI5). Never throws — every failure is returned as
 * a ready-made `CallToolResult` (`{ok:false, result}`) so callers can just
 * `return` it, keeping `mcp/src/tools/**` free of inline `throw`/error
 * construction (WI6).
 */
export type Resolved<T> = { ok: true; value: T } | { ok: false; result: CallToolResult };

export async function resolveRepo(api: ApiClient, repo: string): Promise<Resolved<Repo>> {
  let repos: Repo[];
  try {
    repos = await api.get<Repo[]>('/repos');
  } catch (err) {
    return { ok: false, result: apiFailureToolError(err, api.baseUrl) };
  }
  const match = repos.find((r) => r.full_name.toLowerCase() === repo.toLowerCase());
  if (!match) {
    const known = repos.map((r) => r.full_name).join(', ') || '(none configured)';
    return {
      ok: false,
      result: toolError(
        `Repo "${repo}" is not in DevDigest. Known repos: ${known}. Add it in the web UI at http://localhost:3000.`,
      ),
    };
  }
  return { ok: true, value: match };
}

export async function resolvePr(api: ApiClient, repo: Repo, pr: number): Promise<Resolved<PrMeta>> {
  let pulls: PrMeta[];
  try {
    pulls = await api.get<PrMeta[]>(`/repos/${repo.id}/pulls`);
  } catch (err) {
    return { ok: false, result: apiFailureToolError(err, api.baseUrl) };
  }
  const match = pulls.find((p) => p.number === pr);
  if (!match) {
    const known = pulls.map((p) => p.number).join(', ') || '(none imported)';
    return {
      ok: false,
      result: toolError(`PR #${pr} not found in ${repo.full_name}. Known PR numbers: ${known}.`),
    };
  }
  return { ok: true, value: match };
}

export async function resolveAgent(api: ApiClient, agent: string): Promise<Resolved<Agent>> {
  let agents: Agent[];
  try {
    agents = await api.get<Agent[]>('/agents');
  } catch (err) {
    return { ok: false, result: apiFailureToolError(err, api.baseUrl) };
  }
  const byId = agents.find((a) => a.id === agent);
  const match = byId ?? agents.find((a) => a.name.toLowerCase() === agent.toLowerCase());
  if (!match) {
    return {
      ok: false,
      result: toolError(`Agent "${agent}" not found. Call list_agents to get valid agent ids.`),
    };
  }
  return { ok: true, value: match };
}
