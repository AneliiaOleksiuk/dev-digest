/* hooks/eval.ts — Eval Pipeline (L06, docs/plans/eval-pipeline.md WI9)
   React Query hooks. Structural copy of hooks/brief.ts (read queries +
   explicit-invalidate mutations) — reads never trigger a model call
   server-side (AC-22/AC-33); the two run mutations are the only paths that
   can (AC-45, rate-limited server-side). No ad-hoc `fetch` anywhere in a
   component (AC-40, client/AGENTS.md) — everything below goes through
   `src/lib/api.ts`. */
"use client";

import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  EvalBatchRecord,
  EvalCaseInput,
  EvalCaseRecord,
  EvalComparison,
  EvalDashboard,
  EvalRunRecord,
} from "../types";

// ===========================================================================
// Case CRUD (WI4)
// ===========================================================================

/** GET /agents/:id/eval-cases — an agent's eval set (workspace-scoped). */
export function useAgentEvalCases(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-eval-cases", agentId],
    queryFn: () => api.get<EvalCaseRecord[]>(`/agents/${agentId}/eval-cases`),
    enabled: !!agentId,
  });
}

/** GET /eval-cases/:id — one case (degrades on a corrupt expected_output
 *  rather than throwing, AC-13 — see EvalCaseRecord.expectation_status). */
export function useEvalCase(id: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-case", id],
    queryFn: () => api.get<EvalCaseRecord>(`/eval-cases/${id}`),
    enabled: !!id,
  });
}

/** Create payload for the "New case" editor — `owner_kind` is always
 *  `'agent'` this iteration (D-9), forced by the hook rather than the
 *  caller so a form component can't accidentally send `'skill'`. */
export type CreateEvalCaseInput = Omit<EvalCaseInput, "owner_kind">;

/** POST /eval-cases — hand-authored case (as opposed to WI5's
 *  create-from-finding). */
export function useCreateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEvalCaseInput) =>
      api.post<EvalCaseRecord>("/eval-cases", { ...input, owner_kind: "agent" }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["agent-eval-cases", data.owner_id] });
      qc.invalidateQueries({ queryKey: ["eval-dashboard"] });
      qc.invalidateQueries({ queryKey: ["agent-eval-dashboard", data.owner_id] });
    },
  });
}

/** POST /findings/:id/eval-case — one-click "create case from finding"
 *  (WI5). Everything but an optional case name is server-derived from the
 *  finding's persisted accept/dismiss state (AC-3, D-7); the finding id is
 *  a route param, never a body field. */
export function useCreateEvalCaseFromFinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ findingId, name }: { findingId: string; name?: string }) =>
      // The server requires a JSON body here (EvalCaseFromFindingInput is a
      // z.object, even though `name` itself is optional) — `{}` still counts
      // as "a body was sent", `undefined` doesn't (api.post skips the
      // content-type header entirely when body is falsy), which Fastify's
      // zod validator then rejects as 422 on an absent body.
      api.post<EvalCaseRecord>(`/findings/${findingId}/eval-case`, name ? { name } : {}),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["agent-eval-cases", data.owner_id] });
      qc.invalidateQueries({ queryKey: ["eval-dashboard"] });
      qc.invalidateQueries({ queryKey: ["agent-eval-dashboard", data.owner_id] });
    },
  });
}

/** PATCH /eval-cases/:id — name/input_diff/input_meta/expected_output/notes
 *  editable after creation (AC-10); `expected_output` is re-validated
 *  server-side on save. */
export function useUpdateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<EvalCaseInput> }) =>
      api.patch<EvalCaseRecord>(`/eval-cases/${id}`, patch),
    onSuccess: (data) => {
      qc.setQueryData(["eval-case", data.id], data);
      qc.invalidateQueries({ queryKey: ["agent-eval-cases", data.owner_id] });
    },
  });
}

/** DELETE /eval-cases/:id — `ownerId` travels alongside so the right
 *  agent's case list + dashboards get invalidated (the delete response
 *  itself carries no owner). */
export function useDeleteEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; ownerId: string }) =>
      api.del<{ ok: boolean }>(`/eval-cases/${id}`),
    onSuccess: (_data, { id, ownerId }) => {
      qc.removeQueries({ queryKey: ["eval-case", id] });
      qc.invalidateQueries({ queryKey: ["agent-eval-cases", ownerId] });
      qc.invalidateQueries({ queryKey: ["eval-dashboard"] });
      qc.invalidateQueries({ queryKey: ["agent-eval-dashboard", ownerId] });
    },
  });
}

// ===========================================================================
// Batch runner (WI7) — the only two paths that spend money
// ===========================================================================

/** POST /agents/:id/eval-runs — run the agent's WHOLE case set as one
 *  version-pinned batch (AC-14, rate-limited 10/min server-side, AC-45). */
export function useRunEvalSet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => api.post<EvalBatchRecord>(`/agents/${agentId}/eval-runs`),
    onSuccess: (data, agentId) => {
      qc.invalidateQueries({ queryKey: ["agent-eval-batches", agentId] });
      qc.invalidateQueries({ queryKey: ["agent-eval-dashboard", agentId] });
      qc.invalidateQueries({ queryKey: ["eval-dashboard"] });
      qc.invalidateQueries({ queryKey: ["eval-batch", data.id] });
    },
  });
}

/** POST /eval-cases/:id/run — a single case → a one-case batch (AC-14's
 *  invariants hold for both paths). `ownerId` travels alongside so the
 *  right agent's history/dashboard get invalidated. */
export function useRunEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ caseId }: { caseId: string; ownerId: string }) =>
      api.post<EvalBatchRecord>(`/eval-cases/${caseId}/run`),
    onSuccess: (data, { caseId, ownerId }) => {
      qc.invalidateQueries({ queryKey: ["eval-case", caseId] });
      qc.invalidateQueries({ queryKey: ["agent-eval-cases", ownerId] });
      qc.invalidateQueries({ queryKey: ["agent-eval-batches", ownerId] });
      qc.invalidateQueries({ queryKey: ["agent-eval-dashboard", ownerId] });
      qc.invalidateQueries({ queryKey: ["eval-dashboard"] });
      qc.invalidateQueries({ queryKey: ["eval-batch", data.id] });
    },
  });
}

// ===========================================================================
// Read APIs — dashboard, history, compare (WI8, zero model calls)
// ===========================================================================

/** GET /eval-dashboard — workspace-wide, one entry per agent that has
 *  either a case or a batch (E-15 — an owner keeps its history even after
 *  every one of its cases has been deleted). Drives the Eval Dashboard
 *  page (WI13). */
export function useEvalDashboard() {
  return useQuery({
    queryKey: ["eval-dashboard"],
    queryFn: () => api.get<EvalDashboard[]>("/eval-dashboard"),
  });
}

/** GET /agents/:id/eval-dashboard — per-agent dashboard (current metrics,
 *  delta, trend, recent batches). Drives the Evals tab + the per-agent
 *  detail view. */
export function useAgentEvalDashboard(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-eval-dashboard", agentId],
    queryFn: () => api.get<EvalDashboard>(`/agents/${agentId}/eval-dashboard`),
    enabled: !!agentId,
  });
}

/** GET /agents/:id/eval-batches — an agent's batch history (rows for the
 *  recent-runs table + the compare view's base/head pickers). */
export function useAgentEvalBatches(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-eval-batches", agentId],
    queryFn: () => api.get<EvalBatchRecord[]>(`/agents/${agentId}/eval-batches`),
    enabled: !!agentId,
  });
}

/** GET /agents/:id/eval-compare?base=&head= — two batches side by side,
 *  read-only (D-8, Q-2 — no promote/revert). */
export function useEvalCompare(
  agentId: string | null | undefined,
  baseId: string | null | undefined,
  headId: string | null | undefined,
) {
  return useQuery({
    queryKey: ["eval-compare", agentId, baseId, headId],
    queryFn: () =>
      api.get<EvalComparison>(`/agents/${agentId}/eval-compare?base=${baseId}&head=${headId}`),
    enabled: !!agentId && !!baseId && !!headId,
  });
}

/**
 * One batch's own detail (its aggregate + every per-case `eval_runs` row).
 * NOT one of the 12 hooks the plan named by name — added because AC-35's
 * per-case "last recall"/pass-fail in the Evals tab needs a case's most
 * recent run, and the server has no per-case-across-batches endpoint
 * (`docs/plans/eval-pipeline.md` WI9 lists no such read). `EvalsTab`
 * reconstructs "last run per case" by walking an agent's recent batches
 * (newest first, from `EvalDashboard.recent_runs`) via `useEvalBatches`
 * below and taking the first match per `case_id` — see
 * `EvalsTab/helpers.ts`'s `buildLastRunByCase`.
 */
export interface EvalBatchDetail {
  batch: EvalBatchRecord;
  runs: EvalRunRecord[];
}

export function useEvalBatch(batchId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-batch", batchId],
    queryFn: () => api.get<EvalBatchDetail>(`/eval-batches/${batchId}`),
    enabled: !!batchId,
  });
}

/** Parallel batch-detail reads for a bounded set of batch ids — same
 *  `useQueries` shape `hooks/context.ts`'s `useSkillContexts` already
 *  established for "one query per item in a list that varies per render". */
export function useEvalBatches(batchIds: string[]) {
  return useQueries({
    queries: batchIds.map((id) => ({
      queryKey: ["eval-batch", id],
      queryFn: () => api.get<EvalBatchDetail>(`/eval-batches/${id}`),
      enabled: !!id,
    })),
  });
}
