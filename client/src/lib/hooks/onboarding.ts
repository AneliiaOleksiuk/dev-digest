/* hooks/onboarding.ts — Onboarding Tour (SPEC-02) React Query hooks.
   Structural copy of hooks/blast.ts (read) + hooks/repo-intel.ts's mutation
   shape (write). Read never triggers a model call server-side (AC-1); the
   mutation is the only path that can (AC-2/AC-6). */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { OnboardingTourResponse } from "../types";

/** GET /repos/:id/onboarding — the stored tour, or a model-free skeleton. */
export function useOnboardingTour(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["onboarding-tour", repoId],
    queryFn: () => api.get<OnboardingTourResponse>(`/repos/${repoId}/onboarding`),
    enabled: !!repoId,
  });
}

/** POST /repos/:id/onboarding/generate — the confirmed generation (AC-6).
 *  Caller is responsible for the confirm step BEFORE calling `mutate()`. */
export function useGenerateOnboardingTour(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<OnboardingTourResponse>(`/repos/${repoId}/onboarding/generate`),
    onSuccess: (data) => {
      qc.setQueryData(["onboarding-tour", repoId], data);
    },
  });
}
