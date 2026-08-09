import { z } from 'zod';

/**
 * Input + output schemas for all five tools (WI3). Inputs are FLAT SCALARS
 * ONLY — no nested objects or arrays — so a model never has to construct a
 * nested argument shape. Outputs are compact, hand-built projections of the
 * upstream `@devdigest/shared` contracts, never a passthrough of the raw DB
 * record (principle #3).
 *
 * These enums are redefined locally (not imported as values from
 * `@devdigest/shared`) — every `mcp/` import of that package is `import
 * type` only, see AGENTS.md. Keep in sync by hand if the upstream contracts
 * change (same manual-mirror convention the repo already uses for
 * `@devdigest/shared` itself).
 */

export const SEVERITY = z.enum(['CRITICAL', 'WARNING', 'SUGGESTION']);
export const VERDICT = z.enum(['request_changes', 'approve', 'comment']);
export const CONVENTION_STATUS = z.enum(['pending', 'accepted', 'rejected']);

/** Cap on findings returned per call — "one bloated response can burn tens
 *  of thousands of tokens" (principle #3). */
export const MAX_FINDINGS = 50;

// ---- list_agents -----------------------------------------------------

export const ListAgentsInputShape = {};

export const AgentSummaryShape = {
  id: z.string(),
  name: z.string(),
  description: z.string(),
  model: z.string(),
};
export const AgentSummarySchema = z.object(AgentSummaryShape);
export type AgentSummary = z.infer<typeof AgentSummarySchema>;

export const ListAgentsOutputShape = { agents: z.array(AgentSummarySchema) };
export const ListAgentsOutputSchema = z.object(ListAgentsOutputShape);
export type ListAgentsOutput = z.infer<typeof ListAgentsOutputSchema>;

// ---- run_agent_on_pr / get_findings (shared arg vocabulary) -----------

export const RunAgentOnPrInputShape = {
  repo: z.string().min(1).describe('owner/name, e.g. "acme/payments-api"'),
  pr: z.number().int().describe('the GitHub PR number (not the internal id)'),
  agent: z.string().min(1).describe('agent id, from list_agents'),
};
export const RunAgentOnPrInputSchema = z.object(RunAgentOnPrInputShape);
export type RunAgentOnPrInput = z.infer<typeof RunAgentOnPrInputSchema>;

export const GetFindingsInputShape = {
  repo: z.string().min(1).describe('owner/name, e.g. "acme/payments-api"'),
  pr: z.number().int().describe('the GitHub PR number (not the internal id)'),
  agent: z.string().min(1).optional().describe('agent id; omit for the latest review by any agent'),
};
export const GetFindingsInputSchema = z.object(GetFindingsInputShape);
export type GetFindingsInput = z.infer<typeof GetFindingsInputSchema>;

export const CompactFindingShape = {
  severity: SEVERITY,
  file: z.string(),
  /** Pre-formatted "42" or "42-58". */
  lines: z.string(),
  title: z.string(),
  rationale: z.string(),
  suggestion: z.string().nullish(),
};
export const CompactFindingSchema = z.object(CompactFindingShape);
export type CompactFinding = z.infer<typeof CompactFindingSchema>;

export const VerdictResultShape = {
  verdict: VERDICT.nullable(),
  score: z.number().int().nullable(),
  summary: z.string().nullable(),
  run_id: z.string().nullable(),
  findings: z.array(CompactFindingSchema),
  /** Present only when findings were capped at MAX_FINDINGS (> 0). */
  omitted_findings: z.number().int().optional(),
};
export const VerdictResultSchema = z.object(VerdictResultShape);
export type VerdictResult = z.infer<typeof VerdictResultSchema>;

// ---- get_conventions ---------------------------------------------------

export const GetConventionsInputShape = {
  repo: z.string().min(1).describe('owner/name, e.g. "acme/payments-api"'),
};
export const GetConventionsInputSchema = z.object(GetConventionsInputShape);
export type GetConventionsInput = z.infer<typeof GetConventionsInputSchema>;

export const ConventionSummaryShape = {
  category: z.string().nullable(),
  rule: z.string(),
  /** Pre-formatted "path:line" (or bare path when no line is recorded). */
  evidence: z.string(),
  status: CONVENTION_STATUS,
};
export const ConventionSummarySchema = z.object(ConventionSummaryShape);
export type ConventionSummary = z.infer<typeof ConventionSummarySchema>;

export const GetConventionsOutputShape = {
  conventions: z.array(ConventionSummarySchema),
  /** Present only when `conventions` is empty — points at the extract action. */
  note: z.string().optional(),
};
export const GetConventionsOutputSchema = z.object(GetConventionsOutputShape);
export type GetConventionsOutput = z.infer<typeof GetConventionsOutputSchema>;

// ---- get_blast_radius (WI7 — L04) --------------------------------------

export const GetBlastRadiusInputShape = {
  repo: z.string().min(1).describe('owner/name, e.g. "acme/payments-api"'),
  pr: z.number().int().describe('the GitHub PR number (not the internal id)'),
};
export const GetBlastRadiusInputSchema = z.object(GetBlastRadiusInputShape);
export type GetBlastRadiusInput = z.infer<typeof GetBlastRadiusInputSchema>;

/** Redeclared locally (not imported as a value) — same reason as SEVERITY/VERDICT above. */
export const BLAST_STATUS = z.enum(['full', 'partial', 'degraded']);

/** Caps for THIS tool's output — a smaller, separate token budget than the
 *  web UI's own `MAX_CALLERS_PER_SYMBOL`/display caps (principle #3). */
export const MAX_BLAST_SYMBOLS = 15;
export const MAX_BLAST_CALLERS_PER_SYMBOL = 10;

export const CompactBlastCallerShape = {
  name: z.string(),
  file: z.string(),
  line: z.number().int(),
};
export const CompactBlastCallerSchema = z.object(CompactBlastCallerShape);
export type CompactBlastCaller = z.infer<typeof CompactBlastCallerSchema>;

export const CompactChangedSymbolShape = {
  name: z.string(),
  file: z.string(),
  kind: z.string(),
};
export const CompactChangedSymbolSchema = z.object(CompactChangedSymbolShape);
export type CompactChangedSymbol = z.infer<typeof CompactChangedSymbolSchema>;

export const CompactDownstreamImpactShape = {
  symbol: z.string(),
  callers: z.array(CompactBlastCallerSchema),
  endpoints_affected: z.array(z.string()),
  crons_affected: z.array(z.string()),
  /** Present only when this symbol's callers were capped at MAX_BLAST_CALLERS_PER_SYMBOL. */
  omitted_callers: z.number().int().optional(),
};
export const CompactDownstreamImpactSchema = z.object(CompactDownstreamImpactShape);
export type CompactDownstreamImpact = z.infer<typeof CompactDownstreamImpactSchema>;

export const GetBlastRadiusOutputShape = {
  status: BLAST_STATUS,
  reason: z.string().nullable(),
  summary: z.string(),
  changed_symbols: z.array(CompactChangedSymbolSchema),
  downstream: z.array(CompactDownstreamImpactSchema),
  /** Present only when `changed_symbols` was capped at MAX_BLAST_SYMBOLS. */
  omitted_symbols: z.number().int().optional(),
};
export const GetBlastRadiusOutputSchema = z.object(GetBlastRadiusOutputShape);
export type GetBlastRadiusOutput = z.infer<typeof GetBlastRadiusOutputSchema>;
