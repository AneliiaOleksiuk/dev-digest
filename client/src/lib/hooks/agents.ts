/* hooks/agents.ts — React Query hooks for the A2 Agents tab + Agent Editor. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Agent, AgentSkillLink, AgentStats, ModelInfo, Provider, ReviewStrategy } from "@devdigest/shared";
import { rangeQueryKey, rangeQueryString, type RangeQuery } from "./range";

export function useAgents() {
  return useQuery({
    queryKey: ["agents"],
    queryFn: () => api.get<Agent[]>("/agents"),
  });
}

export function useAgent(id: string | null | undefined) {
  return useQuery({
    queryKey: ["agent", id],
    queryFn: () => api.get<Agent>(`/agents/${id}`),
    enabled: !!id,
  });
}

export interface CreateAgentInput {
  name: string;
  description?: string;
  provider: Provider;
  model: string;
  system_prompt: string;
  output_schema?: unknown;
  strategy?: ReviewStrategy;
  enabled?: boolean;
}

export function useCreateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAgentInput) => api.post<Agent>("/agents", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents"] }),
  });
}

export interface UpdateAgentInput {
  id: string;
  patch: Partial<
    Pick<
      Agent,
      | "name"
      | "description"
      | "provider"
      | "model"
      | "system_prompt"
      | "output_schema"
      | "strategy"
      | "ci_fail_on"
      | "repo_intel"
      | "enabled"
    >
  >;
}

export function useUpdateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateAgentInput) => api.put<Agent>(`/agents/${id}`, patch),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.setQueryData(["agent", data.id], data);
    },
  });
}

export function useDeleteAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/agents/${id}`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.removeQueries({ queryKey: ["agent", id] });
    },
  });
}

/**
 * SPEC-06 WI8 — `GET /agents/:id/stats`, range-scoped per-agent quality/cost
 * stats for the Agent Editor's Stats tab. Typed against `AgentStats` from
 * `@devdigest/shared` — traces to `server/src/modules/agents/service.ts`'s
 * `agentStats()` handler (registered by `routes.ts`'s
 * `GET /agents/:id/stats`), the ONLY server function that returns this exact
 * shape (E-1 / client/INSIGHTS.md's field-name-mismatch lesson: check this
 * comment against the real handler before assuming this type is still
 * accurate).
 *
 * Deliberately NOT named `useAgentStats` — that name is already exported by
 * `lib/hooks/multi-agent.ts` for the DIFFERENT `GET /agents/stats` endpoint
 * (no `:id`), and `hooks/index.ts` re-exports every hook file with
 * `export *`, so reusing the name would be a barrel collision.
 */
export function useAgentDetailStats(agentId: string | null | undefined, range: RangeQuery) {
  return useQuery({
    queryKey: ["agent-detail-stats", agentId, rangeQueryKey(range)],
    queryFn: () => api.get<AgentStats>(`/agents/${agentId}/stats${rangeQueryString(range)}`),
    enabled: !!agentId,
  });
}

/** Dynamic model list for a provider (editor model picker). */
export function useProviderModels(provider: Provider | null | undefined) {
  return useQuery({
    queryKey: ["provider-models", provider],
    queryFn: () => api.get<ModelInfo[]>(`/providers/${provider}/models`),
    enabled: !!provider,
    staleTime: 5 * 60_000,
  });
}

/** Skills linked to an agent, ordered (Agent Editor Skills tab). */
export function useAgentSkills(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-skills", agentId],
    queryFn: () => api.get<AgentSkillLink[]>(`/agents/${agentId}/skills`),
    enabled: !!agentId,
  });
}

/** Replace an agent's full ordered set of linked skills. Optimistic: the
 *  Skills tab's drag/toggle interactions need instant feedback, and a failed
 *  save must roll back to what the server actually has, not leave the UI
 *  showing a change that never persisted. */
export function useSetAgentSkills() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, skillIds }: { agentId: string; skillIds: string[] }) =>
      api.post<AgentSkillLink[]>(`/agents/${agentId}/skills`, { skill_ids: skillIds }),
    onMutate: async ({ agentId, skillIds }) => {
      await queryClient.cancelQueries({ queryKey: ["agent-skills", agentId] });
      const previousLinks = queryClient.getQueryData<AgentSkillLink[]>(["agent-skills", agentId]);
      queryClient.setQueryData<AgentSkillLink[]>(
        ["agent-skills", agentId],
        skillIds.map((skillId, order) => ({ agent_id: agentId, skill_id: skillId, order })),
      );
      return { previousLinks };
    },
    onError: (_error, { agentId }, context) => {
      if (context?.previousLinks) {
        queryClient.setQueryData(["agent-skills", agentId], context.previousLinks);
      }
    },
    onSettled: (_data, _error, { agentId }) => {
      queryClient.invalidateQueries({ queryKey: ["agent-skills", agentId] });
    },
  });
}
