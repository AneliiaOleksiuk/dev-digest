/* hooks/brief.ts — PR Brief & Why Timeline (SPEC-03) React Query hooks.
   Structural copy of hooks/onboarding.ts (read + generate mutation shape).
   Reads never trigger a model call server-side (AC-1/AC-14/AC-15); the
   generate mutation is the only path that can (AC-3). */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { BriefResponse, BriefTimelineResponse } from "../types";

/** GET /pulls/:id/brief — the persisted brief for the PR's current head_sha,
 *  or an honest absent/stale/corrupt state. */
export function usePrBrief(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["pr-brief", prId],
    queryFn: () => api.get<BriefResponse>(`/pulls/${prId}/brief`),
    enabled: !!prId,
  });
}

/** GET /pulls/:id/brief/timeline — every persisted brief for the PR, newest
 *  first. Lazy: only fetched once the Why Timeline disclosure is opened. */
export function usePrBriefTimeline(prId: string | null | undefined, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["pr-brief-timeline", prId],
    queryFn: () => api.get<BriefTimelineResponse>(`/pulls/${prId}/brief/timeline`),
    enabled: !!prId && (options?.enabled ?? false),
  });
}

/** POST /pulls/:id/brief/generate — the confirmed (re)generation. */
export function useGeneratePrBrief(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { headSha: string; force?: boolean }) =>
      api.post<BriefResponse>(`/pulls/${prId}/brief/generate`, {
        head_sha: input.headSha,
        force: input.force,
      }),
    onSuccess: (data) => {
      qc.setQueryData(["pr-brief", prId], data);
      // A `budget_exceeded`/`failed` outcome persists nothing server-side —
      // invalidating the timeline for those would just re-fetch the exact
      // same rows, so skip it.
      if (data.state !== "budget_exceeded" && data.state !== "failed") {
        qc.invalidateQueries({ queryKey: ["pr-brief-timeline", prId] });
      }
    },
  });
}
