import { z } from 'zod';
import { EvalCaseInputMeta, EvalExpectation } from '@devdigest/shared';
import type { EvalCaseRecord, EvalExpectationEntry } from '@devdigest/shared';
import { AppError } from '../../platform/errors.js';
import { FULL_FILE_KINDS, MAX_INPUT_DIFF_BYTES } from './constants.js';
import type { EvalCaseRow } from './repository.js';

/**
 * Pure functions only — no DB, no adapters, no `Container` (onion-architecture
 * `no-helpers-to-io` rule). `platform/errors.ts` is domain error taxonomy, not
 * I/O, so it's fine to import here (same as every other module's helpers.ts
 * that throws a named `AppError`).
 */

/** `input_files`'s read-side shape — a plain array of file paths. */
const InputFiles = z.array(z.string());

/**
 * Row → API read shape. A stored `expected_output` that fails to re-parse
 * against `EvalExpectation` degrades to `expectation_status: 'unusable'` +
 * `expected_output: null` rather than throwing (AC-13, E-12) — the entire
 * reason `EvalCaseRecord` carries that field.
 *
 * `input_meta`/`input_files` get the SAME "degrade rather than throw"
 * treatment via `input_status`, kept as its own field rather than folded
 * into `expectation_status` — the two are orthogonal (a case can have a
 * perfectly scoreable `expected_output` with corrupt/legacy `input_meta`,
 * or vice versa; see the field's doc comment in the contract for the full
 * rationale). A `null` stored value (nothing pinned, or a pre-this-fix row)
 * is not corruption — it re-parses successfully as `null`, same as
 * `expected_output`'s own nullable handling.
 */
export function mapRowToRecord(row: EvalCaseRow): EvalCaseRecord {
  const parsed = EvalExpectation.safeParse(row.expectedOutput);
  const metaParsed = EvalCaseInputMeta.nullable().safeParse(row.inputMeta ?? null);
  const filesParsed = InputFiles.nullable().safeParse(row.inputFiles ?? null);
  return {
    id: row.id,
    owner_kind: row.ownerKind,
    owner_id: row.ownerId,
    name: row.name,
    input_diff: row.inputDiff ?? '',
    input_files: filesParsed.success ? filesParsed.data : null,
    input_meta: metaParsed.success ? metaParsed.data : null,
    input_status: metaParsed.success && filesParsed.success ? 'ok' : 'unusable',
    expected_output: parsed.success ? parsed.data : null,
    expectation_status: parsed.success ? 'ok' : 'unusable',
    notes: row.notes ?? null,
  };
}

/**
 * `input_diff` byte-size gate (AC-46). Throws a named `AppError` (not a
 * generic `ValidationError`) so the failure is distinguishable from an
 * ordinary zod validation failure.
 */
export function assertDiffWithinCap(diff: string): void {
  if (Buffer.byteLength(diff, 'utf8') > MAX_INPUT_DIFF_BYTES) {
    throw new AppError(
      'diff_too_large',
      `input_diff exceeds the ${MAX_INPUT_DIFF_BYTES}-byte cap`,
      422,
    );
  }
}

/**
 * Q-6 — derive an expectation entry's `match_scope` from the SOURCE
 * finding's `kind` at case-creation time. Mirrors the exemption
 * `reviewer-core/src/grounding.ts:16` already grants those four kinds,
 * without re-implementing grounding and without `scorer.ts` needing any
 * knowledge of finding kinds.
 */
export function deriveMatchScope(findingKind: string): 'file' | 'range' {
  return FULL_FILE_KINDS.has(findingKind) ? 'file' : 'range';
}

/**
 * AC-3/D-7 — the expectation kind is derived SERVER-SIDE from the finding's
 * own decision timestamps, never client-supplied (there is no "kind" field
 * anywhere in `EvalCaseFromFindingInput`). `null` means "neither accepted
 * nor dismissed yet" — the caller must refuse and write nothing.
 */
export function deriveExpectationKind(finding: {
  acceptedAt: Date | null;
  dismissedAt: Date | null;
}): 'must_find' | 'must_not_flag' | null {
  if (finding.acceptedAt) return 'must_find';
  if (finding.dismissedAt) return 'must_not_flag';
  return null;
}

/** Build the one `EvalExpectation` entry a create-from-finding case gets,
 *  carrying `source_finding_id` as provenance (AC-9). */
export function buildExpectationEntry(
  finding: {
    id: string;
    file: string;
    startLine: number;
    endLine: number;
    severity: string;
    category: string;
    title: string;
    kind: string;
  },
): EvalExpectationEntry {
  return {
    file: finding.file,
    start_line: finding.startLine,
    end_line: finding.endLine,
    match_scope: deriveMatchScope(finding.kind),
    severity: finding.severity,
    category: finding.category,
    title: finding.title,
    source_finding_id: finding.id,
  };
}

/**
 * Reassemble a unified-diff text from pinned `pr_files` rows, in EXACTLY the
 * shape `modules/reviews/diff-loader.ts`'s `diffFromPrFiles` builds (four
 * lines per file: `diff --git`, `---`, `+++`, the raw patch) — re-implemented
 * here (not imported) since that function takes a `ReviewRepository`, which
 * this module must not import (onion "Cross-module reads" rule). Files with
 * no patch are skipped, never rendered as an empty diff — callers that need
 * "no patch at all" to be a refusal (AC-8) check that BEFORE calling this.
 */
export function buildDiffText(files: { path: string; patch: string | null }[]): string {
  const parts: string[] = [];
  for (const f of files) {
    if (!f.patch) continue;
    parts.push(`diff --git a/${f.path} b/${f.path}`);
    parts.push(`--- a/${f.path}`);
    parts.push(`+++ b/${f.path}`);
    parts.push(f.patch);
  }
  return parts.join('\n');
}
