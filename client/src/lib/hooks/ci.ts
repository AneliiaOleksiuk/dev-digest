/* hooks/ci.ts — Export to CI (SPEC-04, docs/plans/spec-04-export-to-ci.md
   WI18) React Query hooks. Structural copy of hooks/eval.ts (read queries +
   explicit-invalidate mutations). `useCiPreview` is deliberately a
   MUTATION, not a query — Preview must never fire on mount (AC-46); it is
   an explicit action from the wizard's perspective even though the server
   route itself has zero side effects. No ad-hoc `fetch` anywhere in a
   component (client/AGENTS.md) — everything below goes through
   `src/lib/api.ts`. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { CiExport, CiExportInputBody, CiExportPreview, CiInstallation, CiRun } from "../types";

// ===========================================================================
// Preview / Install / Zip (WI20 — the Export Wizard's three mutations)
// ===========================================================================

/** POST /agents/:id/export-ci/preview — zero server-side side effects, but
 *  kept as a mutation (not a query) so it only ever runs when explicitly
 *  triggered by the wizard (entering Preview, or changing a Configure
 *  option) — never automatically on mount (AC-2, AC-46). SPEC-05: the
 *  response also carries `ingest_secret_name` (Recommendation 6) — the
 *  secrets panel renders before any installation exists, so the name can't
 *  come from `CiInstallation`. */
export function useCiPreview() {
  return useMutation({
    mutationFn: ({ agentId, input }: { agentId: string; input: CiExportInputBody }) =>
      api.post<CiExportPreview>(`/agents/${agentId}/export-ci/preview`, input),
  });
}

/** POST /agents/:id/export-ci — Install AND "Update CI config" (same route,
 *  AC-45). Mints a one-time ingest token only when a NEW installation is
 *  created (`ingest_token` is `null` on every update). */
export function useCiExport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, input }: { agentId: string; input: CiExportInputBody }) =>
      api.post<CiExport>(`/agents/${agentId}/export-ci`, input),
    onSuccess: (_data, { agentId }) => {
      qc.invalidateQueries({ queryKey: ["agent-ci-installations", agentId] });
      qc.invalidateQueries({ queryKey: ["ci-runs"] });
    },
  });
}

/** POST /agents/:id/export-ci/zip — "Copy files as a zip" (AC-37). Zero
 *  GitHub writes, no installation, no token — returns the archive as a
 *  Blob via `api.postBlob` (the one binary-response exception to
 *  `apiFetch`'s always-JSON contract, see `lib/api.ts`). */
export function useCiExportZip() {
  return useMutation({
    mutationFn: ({ agentId, input }: { agentId: string; input: CiExportInputBody }) =>
      api.postBlob(`/agents/${agentId}/export-ci/zip`, input),
  });
}

// ===========================================================================
// Reads (WI15 server-side — zero GitHub calls, zero LLM calls)
// ===========================================================================

/** GET /agents/:id/ci-installations — an agent's CI installations (AC-43). */
export function useAgentCiInstallations(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-ci-installations", agentId],
    queryFn: () => api.get<CiInstallation[]>(`/agents/${agentId}/ci-installations`),
    enabled: !!agentId,
  });
}

/** Filter shape for `GET /ci/runs` (AC-63) — every field optional here even
 *  though the server defaults `since_days` to 7, so a caller can omit
 *  filters it doesn't want to narrow by. */
export interface CiRunFiltersInput {
  since_days?: number;
  agent_id?: string | null;
  repo?: string | null;
  status?: string | null;
  source?: string | null;
}

function buildRunsQuery(filters: CiRunFiltersInput): string {
  const params = new URLSearchParams();
  if (filters.since_days != null) params.set("since_days", String(filters.since_days));
  if (filters.agent_id) params.set("agent_id", filters.agent_id);
  if (filters.repo) params.set("repo", filters.repo);
  if (filters.status) params.set("status", filters.status);
  if (filters.source) params.set("source", filters.source);
  return params.toString();
}

/** GET /ci/runs — the workspace's CI runs (`source='ci'` only, AC-65),
 *  filterable (AC-63). Drives the (Phase E) CI Runs page. */
export function useCiRuns(filters: CiRunFiltersInput = {}) {
  const qs = buildRunsQuery(filters);
  return useQuery({
    queryKey: ["ci-runs", filters],
    queryFn: () => api.get<CiRun[]>(`/ci/runs${qs ? `?${qs}` : ""}`),
  });
}

// ===========================================================================
// Delete (WI16, Q-6)
// ===========================================================================

/** DELETE /ci/installations/:id — Q-6's documented remedy. `agentId`
 *  travels alongside so the right agent's installation list + CI runs get
 *  invalidated (the delete response itself carries no owner). */
export function useDeleteCiInstallation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; agentId: string }) =>
      api.del<{ ok: boolean }>(`/ci/installations/${id}`),
    onSuccess: (_data, { agentId }) => {
      qc.invalidateQueries({ queryKey: ["agent-ci-installations", agentId] });
      qc.invalidateQueries({ queryKey: ["ci-runs"] });
    },
  });
}
