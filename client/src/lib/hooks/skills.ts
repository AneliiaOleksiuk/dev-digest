/* hooks/skills.ts — React Query hooks for the Skills page + Agent Editor Skills tab. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Skill, SkillVersion } from "@devdigest/shared";

export function useSkills() {
  return useQuery({
    queryKey: ["skills"],
    queryFn: () => api.get<Skill[]>("/skills"),
  });
}

export function useSkill(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill", id],
    queryFn: () => api.get<Skill>(`/skills/${id}`),
    enabled: !!id,
  });
}

export interface UpdateSkillInput {
  id: string;
  patch: Partial<Pick<Skill, "name" | "description" | "type" | "body" | "enabled">>;
}

export function useUpdateSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateSkillInput) => api.put<Skill>(`/skills/${id}`, patch),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["skills"] });
      queryClient.setQueryData(["skill", data.id], data);
    },
  });
}

export function useDeleteSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/skills/${id}`),
    onSuccess: (_deletedResponse, id) => {
      queryClient.invalidateQueries({ queryKey: ["skills"] });
      queryClient.removeQueries({ queryKey: ["skill", id] });
    },
  });
}

export function useSkillVersions(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-versions", id],
    queryFn: () => api.get<SkillVersion[]>(`/skills/${id}/versions`),
    enabled: !!id,
  });
}

export function useImportSkillFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name?: string; body: string }) =>
      api.post<Skill>("/skills/import/file", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["skills"] }),
  });
}

export function useImportSkillUrl() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (url: string) => api.post<Skill>("/skills/import/url", { url }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["skills"] }),
  });
}
