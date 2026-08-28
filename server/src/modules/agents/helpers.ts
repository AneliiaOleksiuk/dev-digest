import type { Agent, AgentVersion, CiFailOn, Provider, ReviewStrategy } from '@devdigest/shared';
import { AgentVersionConfig } from '@devdigest/shared';
import type { AgentRow, AgentVersionRow } from './repository.js';

/**
 * Pure helpers for the agents module — DB row ⇄ DTO mapping and the
 * config-version-bump rule. No I/O; behaviour-identical to the previous inline
 * implementations.
 */

/** Map a persisted agent row to the public `Agent` DTO. */
export function toAgentDto(row: AgentRow): Agent {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    provider: row.provider as Provider,
    model: row.model,
    system_prompt: row.systemPrompt,
    output_schema: row.outputSchema ?? null,
    enabled: row.enabled,
    version: row.version,
    strategy: row.strategy as ReviewStrategy,
    ci_fail_on: row.ciFailOn as CiFailOn,
    repo_intel: row.repoIntel,
  };
}

/**
 * Map a persisted `agent_versions` row to the public `AgentVersion` DTO. The
 * stored `config_json` is untyped jsonb (a snapshot from an older config shape
 * could drift), so it is parsed through `AgentVersionConfig` — a malformed
 * snapshot throws here rather than leaking an unvalidated blob to the client.
 */
export function toAgentVersionDto(row: AgentVersionRow): AgentVersion {
  return {
    agent_id: row.agentId,
    version: row.version,
    config: AgentVersionConfig.parse(row.configJson),
    created_at: row.createdAt.toISOString(),
  };
}

/**
 * L07 (SPEC-04) — one workspace agent's cost/duration estimate for
 * `GET /agents/stats`, scoped to its CURRENT model (OQ-6). Deliberately NOT
 * the shared `AgentStats` contract (`contracts/observability.ts`) — that
 * shape (accept-rate, findings-by-severity, trend, …) is a richer, separate
 * per-agent-detail feature this work item doesn't build; this is a small,
 * server-local response used to power a pre-run cost/duration estimate
 * (e.g. in the multi-agent-run picker), not vendored/shared yet.
 */
export interface AgentCostEstimate {
  agent_id: string;
  agent_name: string;
  avg_duration_ms: number | null;
  avg_cost_usd: number | null;
  sample_size: number;
}

// ---------------------------------------------------------------------------
// SPEC-06 WI1 — range query resolution (pure, no I/O). Shared by
// `GET /agents/:id/stats` and `GET /agents/performance` so both endpoints
// resolve `?range=` identically (AC-1/AC-18).
// ---------------------------------------------------------------------------

export type RangeMode = '1d' | '30d' | 'custom';

export interface RangeQueryInput {
  range?: RangeMode;
  start?: string;
  end?: string;
}

/** A half-open `[start, end)` UTC interval — `end` is exclusive so adjacent
 *  ranges never double-count a run (AC-3). */
export interface ResolvedRange {
  start: Date;
  end: Date;
}

const MS_PER_DAY = 86_400_000;
/** D-11 — the max span a custom range may cover. */
export const MAX_RANGE_DAYS = 366;

function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Route-level validation (AC-4, NFR-2) — called from the zod `superRefine`
 * in `routes.ts` so a bad range 422s BEFORE any handler runs, never via a
 * `.parse()` call inside one. Returns an error message, or null when valid.
 * Only the `custom` mode needs validating: `1d`/`30d` are always
 * server-computed and can't violate `start <= end` or the max span.
 */
export function validateRangeQuery(input: RangeQueryInput): string | null {
  if (input.range !== 'custom') return null;
  if (!input.start || !input.end) return 'start and end are required for a custom range';
  const start = new Date(input.start);
  const end = new Date(input.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 'start/end must be valid dates';
  }
  if (start.getTime() > end.getTime()) return 'start must be <= end';
  const spanDays =
    Math.floor((utcMidnight(end).getTime() - utcMidnight(start).getTime()) / MS_PER_DAY) + 1;
  if (spanDays > MAX_RANGE_DAYS) return `range must not exceed ${MAX_RANGE_DAYS} days`;
  return null;
}

/**
 * Resolve a validated range query into a half-open `[start, end)` UTC
 * interval (AC-1/AC-3/AC-5). `end` always resolves to the UTC midnight AFTER
 * `now` so "today so far" is always included, regardless of what time of day
 * the request lands — `1d`/`30d` are computed relative to that boundary, and
 * a `custom` range's `end` date is treated as fully inclusive (its own
 * resolved end is the midnight AFTER the given end date). `now` is an
 * explicit parameter (not `Date.now()` internally) so this stays pure and
 * testable.
 */
export function resolveRange(input: RangeQueryInput, now: Date = new Date()): ResolvedRange {
  const end = new Date(utcMidnight(now).getTime() + MS_PER_DAY);
  if (input.range === 'custom' && input.start && input.end) {
    const rawStart = utcMidnight(new Date(input.start));
    const rawEnd = new Date(utcMidnight(new Date(input.end)).getTime() + MS_PER_DAY);
    return { start: rawStart, end: rawEnd };
  }
  if (input.range === '1d') {
    return { start: new Date(end.getTime() - MS_PER_DAY), end };
  }
  // default / '30d' (AC-5)
  return { start: new Date(end.getTime() - 30 * MS_PER_DAY), end };
}

/** Fields whose change bumps the agent's config version (anything but `enabled`). */
export interface ConfigChangePatch {
  name?: string;
  description?: string;
  provider?: Provider;
  model?: string;
  systemPrompt?: string;
  outputSchema?: unknown;
  strategy?: ReviewStrategy;
  ciFailOn?: CiFailOn;
  repoIntel?: boolean;
}

/**
 * True when a patch changes config (vs. just toggling `enabled`) relative to the
 * existing row — a config change bumps the version and snapshots agent_versions.
 */
export function isConfigChange(
  existing: Pick<
    AgentRow,
    | 'name'
    | 'description'
    | 'provider'
    | 'model'
    | 'systemPrompt'
    | 'strategy'
    | 'ciFailOn'
    | 'repoIntel'
  >,
  patch: ConfigChangePatch,
): boolean {
  return (
    (patch.name !== undefined && patch.name !== existing.name) ||
    (patch.description !== undefined && patch.description !== existing.description) ||
    (patch.provider !== undefined && patch.provider !== existing.provider) ||
    (patch.model !== undefined && patch.model !== existing.model) ||
    (patch.systemPrompt !== undefined && patch.systemPrompt !== existing.systemPrompt) ||
    (patch.strategy !== undefined && patch.strategy !== existing.strategy) ||
    (patch.ciFailOn !== undefined && patch.ciFailOn !== existing.ciFailOn) ||
    (patch.repoIntel !== undefined && patch.repoIntel !== existing.repoIntel) ||
    patch.outputSchema !== undefined
  );
}
