/**
 * Pure Blast mapping helpers — `BlastResult` + `IndexState` (repo-intel facade
 * shapes) → `BlastRadiusResponse` (the API contract). No DB / adapter /
 * container imports (onion `no-helpers-to-io`).
 */
import type { BlastCaller, BlastRadiusResponse, ChangedSymbol, DownstreamImpact, PriorPr } from '@devdigest/shared';
import type { BlastCallerRow, BlastResult, IndexState } from '../repo-intel/types.js';
import type { PriorPrRow } from './repository.js';
import { DEPTH_NOTE, MAX_CHANGED_SYMBOLS_RENDERED, MAX_ENDPOINTS_LISTED } from './constants.js';

export type BlastStatus = BlastRadiusResponse['status'];

/**
 * `status`/`reason` derivation (WI2 step 5): degraded when the blast read
 * itself degraded OR the index is `degraded`/`failed`; `partial` when the
 * index is `partial` (still usable, but callers may be missing); `full`
 * otherwise. `reason` is always a human sentence, never a bare enum.
 */
export function deriveStatus(
  indexState: IndexState,
  blast: BlastResult,
): { status: BlastStatus; reason: string | null } {
  if (blast.degraded || indexState.status === 'degraded' || indexState.status === 'failed') {
    return {
      status: 'degraded',
      reason:
        'This repo has no usable code index yet, so callers and affected endpoints could not be computed. Index (or re-index) the repo from the repo page, then reload this tab.',
    };
  }
  if (indexState.status === 'partial') {
    const totalFiles = indexState.filesIndexed + indexState.filesSkipped;
    return {
      status: 'partial',
      reason: `This repo's index is partial (${indexState.filesIndexed} of ${totalFiles} files) — some callers may be missing. Re-run the index from the repo page for a complete map.`,
    };
  }
  return { status: 'full', reason: null };
}

/** Per-symbol endpoints/crons: caller-file facts ∪ reverse-import dependents of the declaring file. */
function symbolFacts(
  callerRows: BlastCallerRow[],
  declFile: string,
  factsByFile: BlastResult['factsByFile'],
  dependentFilesByDeclFile: BlastResult['dependentFilesByDeclFile'],
  fallbackEndpoints: string[],
): { endpoints: string[]; crons: string[] } {
  if (!factsByFile) {
    return { endpoints: fallbackEndpoints, crons: [] };
  }
  const endpoints = new Set<string>();
  const crons = new Set<string>();
  const factFiles = new Set<string>([
    ...callerRows.map((c) => c.file),
    ...(dependentFilesByDeclFile?.[declFile] ?? []),
  ]);
  for (const file of factFiles) {
    const facts = factsByFile[file];
    if (!facts) continue;
    for (const endpoint of facts.endpoints) endpoints.add(endpoint);
    for (const cron of facts.crons) crons.add(cron);
  }
  return { endpoints: [...endpoints].slice(0, MAX_ENDPOINTS_LISTED), crons: [...crons] };
}

/** Map the repo-intel facade's `BlastResult` into `changed_symbols` + `downstream[]`. */
export function mapBlastResult(blast: BlastResult): {
  changed_symbols: ChangedSymbol[];
  downstream: DownstreamImpact[];
} {
  const cappedChangedSymbols = blast.changedSymbols.slice(0, MAX_CHANGED_SYMBOLS_RENDERED);
  const changed_symbols: ChangedSymbol[] = cappedChangedSymbols.map((symbol) => ({
    name: symbol.name,
    file: symbol.file,
    kind: symbol.kind,
  }));

  const callersByViaSymbol = new Map<string, BlastCallerRow[]>();
  for (const caller of blast.callers) {
    const existingGroup = callersByViaSymbol.get(caller.viaSymbol);
    if (existingGroup) existingGroup.push(caller);
    else callersByViaSymbol.set(caller.viaSymbol, [caller]);
  }
  const fallbackEndpoints = blast.impactedEndpoints.slice(0, MAX_ENDPOINTS_LISTED);

  const downstream: DownstreamImpact[] = [];
  const seenSymbolNames = new Set<string>();
  for (const symbol of cappedChangedSymbols) {
    if (seenSymbolNames.has(symbol.name)) continue; // one downstream group per distinct symbol name
    seenSymbolNames.add(symbol.name);

    const callerRows = callersByViaSymbol.get(symbol.name) ?? [];
    const callers: BlastCaller[] = callerRows.map((caller) => ({
      name: caller.symbol,
      file: caller.file,
      line: caller.line,
    }));
    const { endpoints, crons } = symbolFacts(
      callerRows,
      symbol.file,
      blast.factsByFile,
      blast.dependentFilesByDeclFile,
      fallbackEndpoints,
    );

    downstream.push({
      symbol: symbol.name,
      callers,
      endpoints_affected: endpoints,
      crons_affected: crons,
    });
  }

  return { changed_symbols, downstream };
}

/**
 * Deterministic, server-composed summary sentence (no LLM) — counts of
 * symbols/callers/files/endpoints, plus the reverse-import depth note so
 * the map is never over-claimed.
 */
export function buildSummary(
  changedSymbolCount: number,
  downstream: DownstreamImpact[],
  status: BlastStatus,
): string {
  if (changedSymbolCount === 0) {
    return 'No symbols are declared in the changed files, so there is nothing to trace downstream.';
  }

  const callerCount = downstream.reduce((sum, group) => sum + group.callers.length, 0);
  const callerFileCount = new Set(downstream.flatMap((group) => group.callers.map((c) => c.file))).size;
  const endpointCount = new Set(downstream.flatMap((group) => group.endpoints_affected)).size;

  const symbolWord = changedSymbolCount === 1 ? 'symbol' : 'symbols';
  const callerWord = callerCount === 1 ? 'caller' : 'callers';
  const fileWord = callerFileCount === 1 ? 'file' : 'files';
  const endpointWord = endpointCount === 1 ? 'endpoint' : 'endpoints';

  const base = `${changedSymbolCount} changed ${symbolWord} reached by ${callerCount} ${callerWord} across ${callerFileCount} ${fileWord}, affecting ${endpointCount} ${endpointWord} — ${DEPTH_NOTE}.`;

  if (status === 'full') return base;
  return `${base} Index status: ${status} — some callers or endpoints may be missing.`;
}

/**
 * `PriorPrRow[]` (repository shape) → `PriorPr[]` (API contract) — the one
 * snake_case boundary conversion this module needs (WI5, L04 follow-ups):
 * `overlappingFiles` → `overlapping_files`.
 */
export function mapPriorPrs(rows: PriorPrRow[]): PriorPr[] {
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    title: row.title,
    author: row.author,
    overlapping_files: row.overlappingFiles,
  }));
}
