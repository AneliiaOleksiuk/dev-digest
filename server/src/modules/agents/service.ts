import type { Container } from '../../platform/container.js';
import type {
  Agent,
  AgentSkillLink,
  AgentVersion,
  CiFailOn,
  ModelInfo,
  Provider,
  ReviewStrategy,
} from '@devdigest/shared';
import { AgentsRepository } from './repository.js';
import { toAgentDto, toAgentVersionDto, type AgentCostEstimate } from './helpers.js';

/**
 * A2 — agents service. Business logic for the Agents tab + Agent Editor.
 * Provider/model selection uses the LLM adapter's dynamic model list.
 *
 * An Agent = provider + model + system_prompt + linked skills + output_schema +
 * enabled. Config changes are versioned via `agent_versions` (repository).
 */

// Re-exported for backwards compatibility; implementation lives in ./helpers.
export { toAgentDto } from './helpers.js';

export interface CreateAgentInput {
  name: string;
  description?: string;
  provider: Provider;
  model: string;
  system_prompt: string;
  output_schema?: unknown;
  strategy?: ReviewStrategy;
  ci_fail_on?: CiFailOn;
  repo_intel?: boolean;
  enabled?: boolean;
}

export interface UpdateAgentInput {
  name?: string;
  description?: string;
  provider?: Provider;
  model?: string;
  system_prompt?: string;
  output_schema?: unknown;
  strategy?: ReviewStrategy;
  ci_fail_on?: CiFailOn;
  repo_intel?: boolean;
  enabled?: boolean;
}

export class AgentsService {
  private repo: AgentsRepository;

  constructor(private container: Container) {
    this.repo = new AgentsRepository(container.db);
  }

  async list(workspaceId: string): Promise<Agent[]> {
    const rows = await this.repo.list(workspaceId);
    return rows.map(toAgentDto);
  }

  async get(workspaceId: string, id: string): Promise<Agent | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toAgentDto(row) : undefined;
  }

  /** Delete an agent (and its versions/skill-links, via cascade). Also
   *  explicitly deletes its project-context attachment rows — `surfaceId`
   *  there carries no FK (R-D, docs/plans/spec-01-project-context.md), so a
   *  cascade can't do this for us. */
  async delete(workspaceId: string, id: string): Promise<boolean> {
    const ok = await this.repo.deleteById(workspaceId, id);
    if (ok) await this.container.contextRepo.deleteForSurface(workspaceId, 'agent', id);
    return ok;
  }

  async create(workspaceId: string, input: CreateAgentInput, userId?: string): Promise<Agent> {
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description,
      provider: input.provider,
      model: input.model,
      systemPrompt: input.system_prompt,
      outputSchema: input.output_schema,
      ...(input.strategy !== undefined ? { strategy: input.strategy } : {}),
      ...(input.ci_fail_on !== undefined ? { ciFailOn: input.ci_fail_on } : {}),
      ...(input.repo_intel !== undefined ? { repoIntel: input.repo_intel } : {}),
      enabled: input.enabled,
      createdBy: userId ?? null,
    });
    return toAgentDto(row);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateAgentInput,
  ): Promise<Agent | undefined> {
    const row = await this.repo.update(workspaceId, id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
      ...(patch.model !== undefined ? { model: patch.model } : {}),
      ...(patch.system_prompt !== undefined ? { systemPrompt: patch.system_prompt } : {}),
      ...(patch.output_schema !== undefined ? { outputSchema: patch.output_schema } : {}),
      ...(patch.strategy !== undefined ? { strategy: patch.strategy } : {}),
      ...(patch.ci_fail_on !== undefined ? { ciFailOn: patch.ci_fail_on } : {}),
      ...(patch.repo_intel !== undefined ? { repoIntel: patch.repo_intel } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    });
    return row ? toAgentDto(row) : undefined;
  }

  /**
   * Config history for an agent, newest version first. Workspace-scoped: returns
   * undefined when the agent isn't in this workspace (the route maps that to 404)
   * so version snapshots can't be read across tenants.
   */
  async listVersions(workspaceId: string, agentId: string): Promise<AgentVersion[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const rows = await this.repo.listVersions(agentId);
    return rows.map(toAgentVersionDto);
  }

  /**
   * A single config snapshot for an agent. Returns undefined when the agent isn't
   * in this workspace OR that version was never recorded (route → 404).
   */
  async getVersion(
    workspaceId: string,
    agentId: string,
    version: number,
  ): Promise<AgentVersion | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const row = await this.repo.getVersion(agentId, version);
    return row ? toAgentVersionDto(row) : undefined;
  }

  /** Linked skills for an agent as AgentSkillLink[] (ordered). */
  async skillLinks(agentId: string): Promise<AgentSkillLink[]> {
    const links = await this.repo.linkedSkills(agentId);
    return links.map((l) => ({ agent_id: agentId, skill_id: l.skill.id, order: l.order }));
  }

  /**
   * WI7 (eval batch runner) — the shape `skillLinks` above can't provide
   * (ids + order only). Additive, read-only, no behaviour change to any
   * existing agents route: exists so `modules/eval` never imports
   * `AgentsRepository` directly (onion-architecture "Cross-module reads"
   * rule) — `modules/reviews/run-executor.ts:231` reaching into
   * `container.agentsRepo.linkedSkills` directly is the pre-existing pattern
   * this method exists specifically to avoid copying for the eval module.
   */
  async linkedSkillsForRun(agentId: string): Promise<
    { skill_id: string; name: string; body: string; enabled: boolean; version: number; order: number }[]
  > {
    const links = await this.repo.linkedSkills(agentId);
    return links.map((l) => ({
      skill_id: l.skill.id,
      name: l.skill.name,
      body: l.skill.body,
      enabled: l.skill.enabled,
      version: l.skill.version,
      order: l.order,
    }));
  }

  /**
   * Set / reorder the agent's linked skills. If `skillIds` is provided, replaces
   * the whole set in that order. Returns the resulting ordered links.
   */
  async setSkills(
    workspaceId: string,
    agentId: string,
    skillIds: string[],
  ): Promise<AgentSkillLink[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    await this.repo.setSkills(agentId, skillIds);
    return this.skillLinks(agentId);
  }

  /** Link a single skill (append or set order) — additive to existing links. */
  async linkSkill(
    workspaceId: string,
    agentId: string,
    skillId: string,
    order?: number,
  ): Promise<AgentSkillLink[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const existing = await this.repo.linkedSkills(agentId);
    const resolvedOrder = order ?? existing.length;
    await this.repo.linkSkill(agentId, skillId, resolvedOrder);
    return this.skillLinks(agentId);
  }

  /**
   * L07 (SPEC-04) — one batched call: every workspace agent's cost/duration
   * estimate, scoped to its CURRENT model (OQ-6). `agent_runs` is owned by
   * the reviews domain (`ReviewRepository`/`run.repo.ts`), not this module —
   * reached via `container.reviewRepo`, the SAME sanctioned cross-cutting DI
   * accessor `ReviewService` itself uses for `container.agentsRepo`
   * (`platform/container.ts`'s "Shared repositories for cross-cutting
   * entities" comment), not a raw `db`/schema import.
   *
   * ONE query for every agent (fix-loop iteration 1 — was an N+1: one
   * `avg()` round trip per agent). `avgStatsForAgents` groups by
   * `(agent_id, model)` across every model an agent has EVER run under, so
   * each agent's row is matched against its own CURRENT `model` here rather
   * than the query being pre-filtered per agent.
   */
  async stats(workspaceId: string): Promise<AgentCostEstimate[]> {
    const agents = await this.repo.list(workspaceId);
    if (agents.length === 0) return [];
    const rows = await this.container.reviewRepo.avgStatsForAgents(
      workspaceId,
      agents.map((a) => a.id),
    );
    const byAgentAndModel = new Map(rows.map((r) => [`${r.agentId}::${r.model}`, r]));
    return agents.map((agent) => {
      const row = byAgentAndModel.get(`${agent.id}::${agent.model}`);
      return {
        agent_id: agent.id,
        agent_name: agent.name,
        avg_duration_ms: row?.avgDurationMs ?? null,
        avg_cost_usd: row?.avgCostUsd ?? null,
        sample_size: row?.sampleSize ?? 0,
      };
    });
  }

  /**
   * Dynamic model list from the provider adapter's /models. Degrades gracefully
   * to [] if the provider key is not configured (the editor still renders).
   */
  async listModels(provider: Provider): Promise<ModelInfo[]> {
    try {
      const llm = await this.container.llm(provider);
      return await llm.listModels();
    } catch {
      return [];
    }
  }
}
