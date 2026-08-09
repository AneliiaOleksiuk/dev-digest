/* hooks/conventions.ts — React Query hooks for the Conventions Lab page. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { ConventionCandidate, Skill } from "@devdigest/shared";

export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["conventions", repoId],
    queryFn: () => api.get<ConventionCandidate[]>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
  });
}

export function useExtractConventions(repoId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<ConventionCandidate[]>(`/repos/${repoId}/conventions/extract`),
    onSuccess: (data) => {
      queryClient.setQueryData(["conventions", repoId], data);
    },
  });
}

export interface UpdateConventionInput {
  id: string;
  repoId: string;
  patch: {
    status?: "pending" | "accepted" | "rejected";
    rule?: string;
    evidence_path?: string;
    evidence_snippet?: string;
  };
}

/**
 * Single-candidate PATCH. Updates only that row in the cache on success —
 * no optimistic snapshot/rollback (those race when several cards are clicked
 * quickly and paint the wrong green borders).
 */
export function useUpdateConvention() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateConventionInput) =>
      api.patch<ConventionCandidate>(`/conventions/${id}`, patch),
    onSuccess: (data, { repoId }) => {
      queryClient.setQueryData<ConventionCandidate[]>(["conventions", repoId], (current) =>
        current?.map((candidate) => (candidate.id === data.id ? data : candidate)),
      );
    },
  });
}

/** Bulk status change (Deselect all) — parallel PATCHes, then refresh the list. */
export function useBulkSetConventionStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      ids,
      status,
    }: {
      repoId: string;
      ids: string[];
      status: "accepted" | "rejected";
    }) => {
      await Promise.all(ids.map((id) => api.patch<ConventionCandidate>(`/conventions/${id}`, { status })));
    },
    onSuccess: (_data, { repoId, ids, status }) => {
      queryClient.setQueryData<ConventionCandidate[]>(["conventions", repoId], (current) => {
        if (!current) return current;
        const idSet = new Set(ids);
        return current.map((candidate) =>
          idSet.has(candidate.id) ? { ...candidate, status } : candidate,
        );
      });
    },
  });
}

export interface PromoteConventionsInput {
  repoId: string;
  conventionIds: string[];
  skill: { name: string; description: string; body: string; enabled?: boolean };
}

export function usePromoteConventions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PromoteConventionsInput) =>
      api.post<Skill>("/conventions/promote", {
        convention_ids: input.conventionIds,
        skill: input.skill,
      }),
    onSuccess: (skill, variables) => {
      // Promoted rows leave the Create-skill pool via skill_id. Patch cache
      // immediately; skip invalidate-refetch of conventions here — a refetch
      // was racing the local selection UI and made cards feel dead after create.
      const promotedIds = new Set(variables.conventionIds);
      queryClient.setQueryData<ConventionCandidate[]>(["conventions", variables.repoId], (current) =>
        current?.map((candidate) =>
          promotedIds.has(candidate.id) ? { ...candidate, skill_id: skill.id } : candidate,
        ),
      );
      queryClient.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}
