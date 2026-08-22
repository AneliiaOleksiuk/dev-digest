import type { IconName } from "@devdigest/ui";
import type { CiRun } from "@/lib/types";

/**
 * CI Runs page helpers (WI22, docs/plans/spec-04-export-to-ci.md Phase E).
 *
 * A single `useCiRuns({ since_days })` fetch backs the whole page — the four
 * non-time filters (agent/repo/status/source) are applied CLIENT-SIDE against
 * that one result set rather than as separate server round-trips. This keeps
 * the filter dropdowns' own option lists (`distinct*Options` below) built
 * from the SAME unfiltered-by-those-four-fields data the table starts from,
 * so picking e.g. one agent never causes the Source dropdown to lose options
 * that belong to a different agent (AC-63 — each filter other than time
 * window defaults to "everything visible").
 */

export interface FilterOption {
  value: string;
  label: string;
}

export interface CiRunsFilterState {
  agentId: string;
  repo: string;
  status: string;
  source: string;
}

/** `""` means "no filter" for every field (the select's "All ___" option). */
export const EMPTY_FILTERS: CiRunsFilterState = { agentId: "", repo: "", status: "", source: "" };

export function applyFilters(runs: CiRun[], filters: CiRunsFilterState): CiRun[] {
  return runs.filter((run) => {
    if (filters.agentId && run.agent_id !== filters.agentId) return false;
    if (filters.repo && run.repo !== filters.repo) return false;
    if (filters.status && run.status !== filters.status) return false;
    if (filters.source && run.source !== filters.source) return false;
    return true;
  });
}

/** Distinct agents actually present in the loaded window, id→label (falls
 *  back to the raw id when no `agent` display name was ingested). Sourced
 *  from the runs themselves rather than `useAgents()` so an agent that was
 *  since deleted still shows up as a filterable option for its past runs
 *  (E-15's precedent — see EvalDashboardView's `ownerLabel`). */
export function distinctAgentOptions(runs: CiRun[]): FilterOption[] {
  const byId = new Map<string, string>();
  for (const run of runs) {
    if (!run.agent_id || byId.has(run.agent_id)) continue;
    byId.set(run.agent_id, run.agent ?? run.agent_id);
  }
  return Array.from(byId, ([value, label]) => ({ value, label })).sort((a, b) =>
    a.label.localeCompare(b.label),
  );
}

function distinctStringOptions(runs: CiRun[], field: "repo" | "source"): FilterOption[] {
  const values = new Set<string>();
  for (const run of runs) {
    const value = run[field];
    if (value) values.add(value);
  }
  return Array.from(values)
    .sort((a, b) => a.localeCompare(b))
    .map((value) => ({ value, label: value }));
}

export function distinctRepoOptions(runs: CiRun[]): FilterOption[] {
  return distinctStringOptions(runs, "repo");
}

/** D-13/E-31 — `source` is a free-form label the CI job supplied at ingest,
 *  never validated against `CiTarget`. The dropdown lists whatever values
 *  were actually ingested ("GitHub Actions", "CircleCI", anything) rather
 *  than a fixed enum, so it never implies a closed set that doesn't exist. */
export function distinctSourceOptions(runs: CiRun[]): FilterOption[] {
  return distinctStringOptions(runs, "source");
}

export function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

/** AC-66/UX-17 — `null` (a failed run measured nothing) renders as a dash,
 *  never a fabricated `0s`. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m ${remainder}s`;
}

export function pullRequestLabel(run: CiRun): string {
  if (run.pr_number == null) return "—";
  return run.pr_title ? `#${run.pr_number} · ${run.pr_title}` : `#${run.pr_number}`;
}

export function agentLabel(run: CiRun): string {
  return run.agent ?? "—";
}

/** D-13/E-31 — rendered VERBATIM, whatever the ingest job reported. No
 *  validation against `CiTarget`, no branching on the value. */
export function sourceLabel(run: CiRun): string {
  return run.source ?? "—";
}

export type FindingsDisplayMode = "split" | "total" | "unknown";

export interface FindingsDisplay {
  mode: FindingsDisplayMode;
  critical: number | null;
  warning: number | null;
  suggestion: number | null;
  total: number | null;
}

/**
 * AC-64/UX-15 — shows the critical/warning/suggestion split when at least
 * one of those three is known; falls back to the plain total only when NONE
 * of them are known; falls back further to "unknown" (renders as a dash,
 * not a `0`) when even the total is null. A severity that is individually
 * null within an otherwise-known split is a field the CALLER should omit
 * entirely, not render as 0 — that distinction is why `critical`/`warning`/
 * `suggestion` stay nullable here rather than being coerced to 0.
 */
export function findingsDisplay(run: CiRun): FindingsDisplay {
  const { critical, warning, suggestion, findings_count } = run;
  const hasSplit = critical != null || warning != null || suggestion != null;
  if (hasSplit) {
    return { mode: "split", critical, warning, suggestion, total: findings_count };
  }
  if (findings_count != null) {
    return { mode: "total", critical: null, warning: null, suggestion: null, total: findings_count };
  }
  return { mode: "unknown", critical: null, warning: null, suggestion: null, total: null };
}

/** AC-67/UX-16 — four visually distinct renderings; `no_findings` reuses
 *  neither `succeeded`'s green nor `failed`'s red (a clean run over an
 *  effectively empty diff must not read as a substantive pass, E-8). Any
 *  status string outside the known four (CiRun.status is a plain nullable
 *  string on the contract, not the closed `CiRunStatus` enum) degrades to a
 *  neutral "unknown" treatment instead of throwing or silently picking one
 *  of the four known colors. Mirrors CiTab's `statusVisual` mapping
 *  (kept feature-local rather than shared — same convention as that file's
 *  own `relativeTime`). */
export function statusVisual(status: string | null): { color: string; bg: string; icon: IconName } {
  if (status === "running") return { color: "var(--accent)", bg: "var(--accent-bg)", icon: "RefreshCw" };
  if (status === "failed") return { color: "var(--crit)", bg: "var(--crit-bg)", icon: "XCircle" };
  if (status === "no_findings") return { color: "var(--text-muted)", bg: "var(--bg-hover)", icon: "CheckCircle" };
  if (status === "succeeded") return { color: "var(--ok)", bg: "var(--ok-bg)", icon: "CheckCircle" };
  return { color: "var(--text-muted)", bg: "var(--bg-hover)", icon: "AlertTriangle" };
}

/** `CiRunStatus` value → the matching `ci.json` `runs.status.*` key. Any
 *  other string (see `statusVisual`'s note) renders as itself. */
export function statusI18nKey(status: string | null): "succeeded" | "failed" | "noFindings" | "running" | null {
  if (status === "no_findings") return "noFindings";
  if (status === "succeeded" || status === "failed" || status === "running") return status;
  return null;
}
