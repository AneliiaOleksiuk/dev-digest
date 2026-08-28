/** Pure helpers for AgentPerformanceView — no I/O, no hooks. */
import type { AgentPerfRow, PerfCostSegment } from "@devdigest/shared";
import type { DonutSegment } from "@devdigest/ui";
import { rangeQueryString, type RangeQuery } from "@/lib/hooks/range";

/** D-15/AC-31 — an agent with fewer than this many DECIDED findings
 *  (accepted + dismissed) is marked low-confidence for accept-rate ranking
 *  purposes: a 1-decision 100% agent is not meaningfully "the best". */
export const LOW_CONFIDENCE_THRESHOLD = 5;

export function decidedCount(row: AgentPerfRow): number {
  return row.accepted + row.dismissed;
}

/** A1/AC-25/US-5 — the Avg accept-rate tile's decided-findings denominator:
 *  sum `accepted`/`decided` across every scored agent row (no contract
 *  change needed — `accepted`/`dismissed` are already on every
 *  `AgentPerfRow`). Matches `summary.avg_accept_rate`'s own POOLED
 *  definition (D-13: total accepted / total decided), so the tile's number
 *  and its denominator are read off the SAME set. */
export function pooledDecided(rows: AgentPerfRow[]): { accepted: number; decided: number } {
  let accepted = 0;
  let decided = 0;
  for (const row of rows) {
    accepted += row.accepted;
    decided += decidedCount(row);
  }
  return { accepted, decided };
}

export function isLowConfidence(row: AgentPerfRow): boolean {
  return decidedCount(row) < LOW_CONFIDENCE_THRESHOLD;
}

export interface RankedAgents {
  /** Sorted desc by accept_rate (agents with a null rate sort last within
   *  this group, which shouldn't happen since a ranked agent has >=
   *  LOW_CONFIDENCE_THRESHOLD decided findings — a non-null denominator). */
  ranked: AgentPerfRow[];
  /** Excluded from ranking (AC-31) — shown in its own flagged group,
   *  ordered by run count desc so it stays a stable, readable list. */
  lowConfidence: AgentPerfRow[];
  /** AC-32 — every scored agent is below the threshold; ranking still
   *  operates (an empty `ranked` group, not an error/crash) and the caller
   *  renders a "not enough data to rank" message instead of a top spot. */
  allLowConfidence: boolean;
}

/** AC-31/AC-32 — the pure sort comparator/grouping rule, exported so
 *  `test-writer` can unit-test it directly against fixtures. */
export function rankByAcceptRate(rows: AgentPerfRow[]): RankedAgents {
  const ranked: AgentPerfRow[] = [];
  const lowConfidence: AgentPerfRow[] = [];
  for (const row of rows) {
    if (isLowConfidence(row)) lowConfidence.push(row);
    else ranked.push(row);
  }
  ranked.sort((a, b) => (b.accept_rate ?? -1) - (a.accept_rate ?? -1));
  lowConfidence.sort((a, b) => b.runs - a.runs);
  return { ranked, lowConfidence, allLowConfidence: ranked.length === 0 && rows.length > 0 };
}

/** E-4/D-9 — donut colors are a client-side presentation concern; the
 *  contract (`PerfCostSegment`) deliberately carries no color. */
const DONUT_PALETTE = [
  "var(--accent)",
  "var(--ok)",
  "var(--warn)",
  "var(--crit)",
  "#8b5cf6",
  "#06b6d4",
  "#f97316",
  "#84cc16",
];

export function withDonutColors(segments: PerfCostSegment[]): DonutSegment[] {
  return segments.map((seg, i) => ({ ...seg, color: DONUT_PALETTE[i % DONUT_PALETTE.length]! }));
}

/** AC-30 — View links to the SAME agent, SAME range, so AC-18's
 *  dashboard-vs-Stats-tab reconciliation is one click away and like-for-like. */
export function agentDetailHref(agentId: string, range: RangeQuery): string {
  const rangeQs = rangeQueryString(range);
  const rangePart = rangeQs ? rangeQs.slice(1) : "range=30d";
  return `/agents/${agentId}?tab=stats&${rangePart}`;
}

/** C4 — quality-based color for the Accept column: green at/above 70%,
 *  amber in the middle, red below 40%; muted when there's no rate yet
 *  (null, not "0%" — AC-12/E-10). Thresholds mirror the values a reviewer
 *  would call "clearly good"/"clearly bad" for an accept-rate; no directional
 *  trend arrow is derived here — `AgentPerfRow` carries no accept-rate-over-
 *  time signal (only `trend`, which is findings-per-run, not accept-rate),
 *  so this is a threshold-only partial fix (scoped down from the mockup's
 *  ↑/↓ arrow — noted in the fix-loop report). */
export function acceptRateColor(rate: number | null): string {
  if (rate == null) return "var(--text-muted)";
  if (rate >= 0.7) return "var(--ok)";
  if (rate >= 0.4) return "var(--warn)";
  return "var(--crit)";
}

export function formatLastRunAt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
}

/** D-5/E-5 — resolve the most-active tile's own run count/accept rate by id,
 *  never by re-deriving from its (non-unique) name. */
export function findAgentById(rows: AgentPerfRow[], id: string | null): AgentPerfRow | undefined {
  if (!id) return undefined;
  return rows.find((r) => r.agent_id === id);
}
