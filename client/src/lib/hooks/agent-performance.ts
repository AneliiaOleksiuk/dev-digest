/* hooks/agent-performance.ts — SPEC-06 WI10. `GET /agents/performance`,
   the workspace-wide Agent Performance dashboard hook. */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { AgentPerf } from "@devdigest/shared";
import { isIncompleteCustomRange, rangeQueryKey, rangeQueryString, validateCustomRange, type RangeQuery } from "./range";

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
    // fix-loop (A2) — don't fire the request while a custom range is only
    // half-entered: the server 422s on a partial `start`/`end` pair, and
    // firing early just surfaces the generic error state for what is really
    // a "still typing" moment, not a failure.
    // fix-loop (Row 12/AC-4) — nor while a COMPLETE custom range is invalid
    // (`start > end`, span > 366 days): same reasoning, the server would 422
    // on it too, and `AgentPerformanceView` renders `validateCustomRange`'s
    // specific copy instead of firing the request.
    enabled: !isIncompleteCustomRange(range) && validateCustomRange(range) === null,
  });
}
