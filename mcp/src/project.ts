import type { Agent, BlastRadiusResponse, ConventionCandidate, FindingRecord, ReviewRecord } from '@devdigest/shared';
import {
  MAX_BLAST_CALLERS_PER_SYMBOL,
  MAX_BLAST_SYMBOLS,
  MAX_FINDINGS,
  type AgentSummary,
  type CompactBlastCaller,
  type CompactDownstreamImpact,
  type ConventionSummary,
  type CompactFinding,
  type GetBlastRadiusOutput,
  type VerdictResult,
} from './schemas.js';

/**
 * Pure projections from the upstream `@devdigest/shared` record shapes to
 * this package's compact DTOs (WI3). Dropped fields are dropped ON PURPOSE
 * — see the "Outputs" table in docs/plans/mcp-server.md, WI3 — never widen
 * these without updating that table too.
 */

export function toAgentSummary(agent: Agent): AgentSummary {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    model: agent.model,
  };
}

const SEVERITY_ORDER: Record<string, number> = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2 };

function formatLines(f: FindingRecord): string {
  return f.start_line === f.end_line ? String(f.start_line) : `${f.start_line}-${f.end_line}`;
}

export function toCompactFinding(f: FindingRecord): CompactFinding {
  return {
    severity: f.severity,
    file: f.file,
    lines: formatLines(f),
    title: f.title,
    rationale: f.rationale,
    suggestion: f.suggestion ?? null,
  };
}

/**
 * Sorts CRITICAL → WARNING → SUGGESTION and caps at MAX_FINDINGS, adding
 * `omitted_findings` when anything was dropped (principle #3).
 */
export function toVerdictResult(review: ReviewRecord): VerdictResult {
  const sorted = [...review.findings].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99),
  );
  const capped = sorted.slice(0, MAX_FINDINGS);
  const omitted = sorted.length - capped.length;
  return {
    verdict: review.verdict,
    score: review.score,
    summary: review.summary,
    run_id: review.run_id,
    findings: capped.map(toCompactFinding),
    ...(omitted > 0 ? { omitted_findings: omitted } : {}),
  };
}

export function toConventionSummary(c: ConventionCandidate): ConventionSummary {
  return {
    category: c.category ?? null,
    rule: c.rule,
    evidence: c.evidence_line != null ? `${c.evidence_path}:${c.evidence_line}` : c.evidence_path,
    status: c.status,
  };
}

/**
 * `BlastRadiusResponse` (server/src/vendor/shared, WI2) → this tool's compact
 * DTO. Caps `changed_symbols` at `MAX_BLAST_SYMBOLS` and each symbol's
 * `callers` at `MAX_BLAST_CALLERS_PER_SYMBOL`, adding `omitted_*` counters
 * when anything was dropped — same treatment as `toVerdictResult`'s
 * `omitted_findings` above. `prior_prs` (added to the contract in WI4, L04
 * follow-ups) is deliberately dropped here too: "which humans touched these
 * files before" is a UI convenience, not something a reviewing model acts
 * on, and mcp/AGENTS.md's token-frugality principle argues against spending
 * output tokens on it (Risk 2, RESOLVED — user, 2026-08-09).
 */
export function toBlastRadiusOutput(blast: BlastRadiusResponse): GetBlastRadiusOutput {
  const cappedSymbols = blast.changed_symbols.slice(0, MAX_BLAST_SYMBOLS);
  const omittedSymbols = blast.changed_symbols.length - cappedSymbols.length;
  const keptSymbolNames = new Set(cappedSymbols.map((symbol) => symbol.name));

  const downstream: CompactDownstreamImpact[] = blast.downstream
    .filter((group) => keptSymbolNames.has(group.symbol))
    .map((group) => {
      const cappedCallers = group.callers.slice(0, MAX_BLAST_CALLERS_PER_SYMBOL);
      const omittedCallers = group.callers.length - cappedCallers.length;
      const callers: CompactBlastCaller[] = cappedCallers.map((caller) => ({
        name: caller.name,
        file: caller.file,
        line: caller.line,
      }));
      return {
        symbol: group.symbol,
        callers,
        endpoints_affected: group.endpoints_affected,
        crons_affected: group.crons_affected,
        ...(omittedCallers > 0 ? { omitted_callers: omittedCallers } : {}),
      };
    });

  return {
    status: blast.status,
    reason: blast.reason,
    summary: blast.summary,
    changed_symbols: cappedSymbols.map((symbol) => ({
      name: symbol.name,
      file: symbol.file,
      kind: symbol.kind,
    })),
    downstream,
    ...(omittedSymbols > 0 ? { omitted_symbols: omittedSymbols } : {}),
  };
}
