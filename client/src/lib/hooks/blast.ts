/* hooks/blast.ts — GET /pulls/:id/blast (deterministic read over repo-intel,
   no LLM). Structural copy of hooks/smart-diff.ts. */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { BlastRadiusResponse } from "@devdigest/shared";

/** Changed symbols + direct callers + endpoints/crons (incl. reverse-import reach). */
export function useBlastRadius(
  prId: string | null | undefined,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ["blast", prId],
    queryFn: () => api.get<BlastRadiusResponse>(`/pulls/${prId}/blast`),
    enabled: !!prId && (options?.enabled ?? true),
  });
}
