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
 *  first. Lazy: only fetched once the Why Timeline disclosure is opened.
 *  `staleTime: Infinity` — the cache is only ever invalidated explicitly, by
 *  `useGeneratePrBrief`'s `onSuccess` below, not by the global 30s default;
 *  otherwise closing and reopening the disclosure after a short pause
 *  re-fetches even though nothing changed. */
export function usePrBriefTimeline(prId: string | null | undefined, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["pr-brief-timeline", prId],
    queryFn: () => api.get<BriefTimelineResponse>(`/pulls/${prId}/brief/timeline`),
    enabled: !!prId && (options?.enabled ?? false),
    staleTime: Infinity,
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
      // A `budget_exceeded`/`failed` outcome persists nothing server-side —
      // its `record` is always null. Writing it into the SAME cache key
      // usePrBrief() reads would silently replace a good, previously-
      // persisted brief with nothing. Consumers (PrBriefCard) read this
      // transient outcome from the mutation's own `data` instead, so the
      // read-cache — and the timeline, which would just re-fetch the exact
      // same rows — are both left untouched for these two states.
      if (data.state === "budget_exceeded" || data.state === "failed") return;
      qc.setQueryData(["pr-brief", prId], data);
      qc.invalidateQueries({ queryKey: ["pr-brief-timeline", prId] });
    },
  });
}
