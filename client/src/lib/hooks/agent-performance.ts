/* hooks/agent-performance.ts — SPEC-06 WI10. `GET /agents/performance`,
   the workspace-wide Agent Performance dashboard hook. */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { AgentPerf } from "@devdigest/shared";
import { rangeQueryKey, rangeQueryString, type RangeQuery } from "./range";

/**
 * `GET /agents/performance`, range-scoped. Typed against the EXTENDED
 * `AgentPerf` contract (`total_cost_partial`/`most_active_agent_id` added by
 * SPEC-06 WI6) — traces to `server/src/modules/agents/service.ts`'s
 * `performance()` handler (registered by `routes.ts`'s
 * `GET /agents/performance`), which calls the SAME shared aggregation as
 * `useAgentDetailStats` above (`lib/hooks/agents.ts`) so a per-agent number
 * here matches that agent's own Stats tab (AC-7/AC-18). Same E-1 discipline
 * as `useAgentDetailStats`: check this comment against the real handler
 * before trusting this type blindly (`lib/api.ts` does zero runtime
 * validation — a shape mismatch fails silently as `undefined`).
 */
export function useAgentPerf(range: RangeQuery) {
  return useQuery({
    queryKey: ["agent-performance", rangeQueryKey(range)],
    queryFn: () => api.get<AgentPerf>(`/agents/performance${rangeQueryString(range)}`),
  });
}
