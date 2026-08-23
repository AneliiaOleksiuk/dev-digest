/* hooks/multi-agent.ts — Multi-Agent Review (L07/SPEC-04) React Query hooks.
   Start a batch, poll it while any column is still running, read per-agent
   quality stats (used for the configure-run screen's estimates), and turn a
   single finding into an eval case.

   The server routes here (POST /pulls/:id/multi-agent-run,
   GET /multi-agent-runs/:id, GET /agents/stats, POST /findings/:id/eval-case)
   are owned by a concurrently-running server work item (G2) — these hooks are
   built against the FIXED endpoint names + `@devdigest/shared` contract shapes
   agreed for this feature, not against an already-running server. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { MultiAgentRun } from "@devdigest/shared";

/** Response shape of `GET /agents/stats` — one batched cost/duration estimate
 *  per workspace agent, scoped server-side to its CURRENT model (OQ-6).
 *
 *  Deliberately NOT the vendored `@devdigest/shared` `AgentStats` contract
 *  (that shape — `runs`/`avg_latency_ms`/accept-rate/findings-by-severity/
 *  trend — is `GET /agents/:id/stats`'s richer per-agent-detail response, a
 *  separate feature this endpoint doesn't build). Mirrors the server's own
 *  local `AgentCostEstimate` (`server/src/modules/agents/helpers.ts`) field
 *  for field — `avg_duration_ms`/`sample_size`, not `avg_latency_ms`/`runs`. */
export interface AgentCostEstimate {
  agent_id: string;
  agent_name: string;
  avg_duration_ms: number | null;
  avg_cost_usd: number | null;
  sample_size: number;
}

/** GET /agents/stats — quality/cost/latency aggregates for every workspace
 *  agent, scoped server-side to each agent's CURRENT model (OQ-6) — an agent
 *  with no completed run under its current model comes back with null
 *  `avg_cost_usd`/`avg_duration_ms`, which the configure-run screen renders as
 *  "no estimate yet" rather than fabricating a number. */
export function useAgentStats() {
  return useQuery({
    queryKey: ["agent-stats"],
    queryFn: () => api.get<AgentCostEstimate[]>("/agents/stats"),
  });
}

/** Response of `POST /pulls/:id/multi-agent-run` — deliberately NOT a
 *  `MultiAgentRun` (that full, assembled shape doesn't exist yet at this
 *  point; every column is still `running`). Mirrors `runBatch`'s actual
 *  return type (`server/src/modules/reviews/multi-agent-service.ts`) field
 *  for field: the parent batch id is `multi_agent_run_id`, not `id`. */
export interface StartMultiAgentRunResult {
  multi_agent_run_id: string;
  runs: { run_id: string; agent_id: string; agent_name: string }[];
}

/** POST /pulls/:id/multi-agent-run — kicks off one batch across the given
 *  agent ids and returns immediately (AC-12), before any agent completes. */
export function useStartMultiAgentRun() {
  return useMutation({
    mutationFn: ({ prId, agentIds }: { prId: string; agentIds: string[] }) =>
      api.post<StartMultiAgentRunResult>(`/pulls/${prId}/multi-agent-run`, { agent_ids: agentIds }),
  });
}

/** GET /multi-agent-runs/:id — the batch's current state (one column per
 *  participating agent + derived groups/conflicts). Polls while any column is
 *  still `running`, so every column's own live status/live log below is
 *  driven by `useRunEvents` per-run instead — this query only needs to catch
 *  up once a run settles (verdict/score/findings/groups/conflicts). */
export function useMultiAgentRun(runId: string | null | undefined) {
  return useQuery({
    queryKey: ["multi-agent-run", runId],
    queryFn: () => api.get<MultiAgentRun>(`/multi-agent-runs/${runId}`),
    enabled: !!runId,
    refetchInterval: (query) =>
      (query.state.data?.columns ?? []).some((c) => c.status === "running") ? 3000 : false,
  });
}

/** Result of POST /findings/:id/eval-case — a lightweight confirmation only
 *  (no eval-management UI exists in this feature's scope, so the response
 *  shape is intentionally minimal rather than a full `EvalCase` contract). */
export interface EvalCaseResult {
  ok: boolean;
  case_id?: string;
}

/** POST /findings/:id/eval-case — turn one finding into an eval case. Distinct
 *  from `useFindingAction` (accept/dismiss/learn/reply): this isn't a
 *  `FindingActionKind`, it's its own endpoint with no persisted-finding-state
 *  side effect to reflect back into the findings cache. */
export function useTurnIntoEvalCase() {
  return useMutation({
    mutationFn: (findingId: string) => api.post<EvalCaseResult>(`/findings/${findingId}/eval-case`),
  });
}
