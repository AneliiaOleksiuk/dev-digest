/* hooks/context.ts — Project Context (SPEC-01) React Query hooks.
   Structural copy of hooks/blast.ts / hooks/conventions.ts. Replaces the
   dead useContextFiles/useReindexContext scaffolding in hooks/core.ts (R-B
   of docs/plans/spec-01-project-context.md) — there is no re-index step in
   this feature (D-4/Non-goals). */
"use client";

import { useQueries, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  ContextAttachmentSet,
  ContextDocumentContent,
  ContextListing,
  ContextWriteResult,
  CreateContextDocumentBody,
  SaveContextDocumentBody,
  SetContextBody,
} from "../types";

// ---- Repo-wide document listing (GET /repos/:repoId/context) ----
export function useContextDocuments(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["context-documents", repoId],
    queryFn: () => api.get<ContextListing>(`/repos/${repoId}/context`),
    enabled: !!repoId,
  });
}

/** Lazy, selection-gated preview fetch — same lazy pattern as
 *  `usePrLatestFindings`. `revision` (AC-37/Rec-1) is the content-hash
 *  staleness token required back on save. */
export function useContextDocument(
  repoId: string | null | undefined,
  path: string | null | undefined,
) {
  return useQuery({
    queryKey: ["context-document", repoId, path],
    queryFn: () =>
      api.get<ContextDocumentContent>(
        `/repos/${repoId}/context/document?path=${encodeURIComponent(path ?? "")}`,
      ),
    enabled: !!repoId && !!path,
  });
}

/** PUT /repos/:repoId/context/document — save an EXISTING document (AC-34).
 *  A 409 (`ApiError.status`) means the on-disk state moved since the editor
 *  loaded it (AC-37) — the caller renders that distinctly from a generic
 *  write failure (AC-39), never retries automatically. */
export function useSaveContextDocument(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SaveContextDocumentBody) =>
      api.put<ContextWriteResult>(`/repos/${repoId}/context/document`, body),
    onSuccess: (_data, body) => {
      qc.invalidateQueries({ queryKey: ["context-documents", repoId] });
      qc.invalidateQueries({ queryKey: ["context-document", repoId, body.path] });
    },
  });
}

/** POST /repos/:repoId/context/document — create a NEW document (AC-41). On
 *  success the document appears via the ordinary discovery walk (AC-42) —
 *  invalidating the listing is enough, no separate "manually added" state. */
export function useCreateContextDocument(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateContextDocumentBody) =>
      api.post<ContextWriteResult>(`/repos/${repoId}/context/document`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["context-documents", repoId] });
    },
  });
}

// ---- Skill Context tab (GET/POST /skills/:id/context) ----
export function useSkillContext(skillId: string | null | undefined, repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-context", skillId, repoId],
    queryFn: () => api.get<ContextAttachmentSet>(`/skills/${skillId}/context?repo_id=${repoId}`),
    enabled: !!skillId && !!repoId,
  });
}

/** Parallel skill-context reads for a set of skill ids (the Agent Context
 *  tab's "inherited from enabled skills" group — one query per skill, via
 *  react-query's `useQueries` so the list can vary per render without
 *  breaking the rules of hooks). */
export function useSkillContexts(skillIds: string[], repoId: string | null | undefined) {
  return useQueries({
    queries: skillIds.map((skillId) => ({
      queryKey: ["skill-context", skillId, repoId],
      queryFn: () => api.get<ContextAttachmentSet>(`/skills/${skillId}/context?repo_id=${repoId}`),
      enabled: !!skillId && !!repoId,
    })),
  });
}

export function useSetSkillContext(skillId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SetContextBody) =>
      api.post<ContextAttachmentSet>(`/skills/${skillId}/context`, body),
    onSuccess: (data, body) => {
      qc.setQueryData(["skill-context", skillId, body.repo_id], data);
      qc.invalidateQueries({ queryKey: ["context-documents", body.repo_id] });
    },
  });
}

// ---- Agent Context tab (GET/POST /agents/:id/context) ----
export function useAgentContext(agentId: string | null | undefined, repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-context", agentId, repoId],
    queryFn: () => api.get<ContextAttachmentSet>(`/agents/${agentId}/context?repo_id=${repoId}`),
    enabled: !!agentId && !!repoId,
  });
}

export function useSetAgentContext(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SetContextBody) =>
      api.post<ContextAttachmentSet>(`/agents/${agentId}/context`, body),
    onSuccess: (data, body) => {
      qc.setQueryData(["agent-context", agentId, body.repo_id], data);
      qc.invalidateQueries({ queryKey: ["context-documents", body.repo_id] });
    },
  });
}
