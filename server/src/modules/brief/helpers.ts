import { z } from 'zod';
import { Brief, BriefInputStatus, BriefRecord } from '@devdigest/shared';

/**
 * Pure helpers (SPEC-03): no DB/adapters/container — `service.ts` owns all
 * I/O, this file only shapes already-fetched data. Mirrors `modules/
 * onboarding/service.ts`'s `responseFromRow`/`reasonForRow` split, made
 * standalone here so it can be unit-tested without a repository double.
 *
 * `BriefRow` below is a LOCAL structural mirror of `db/rows.ts`'s
 * `BriefRow`, not an import of it — `arch:check`'s `no-helpers-to-io` rule
 * forbids helpers.ts importing anything under `src/db/` at all (unlike the
 * `no-service-to-db` rule, which carves out `db/rows.ts` explicitly). A real
 * `BriefRow` is structurally assignable here without an import.
 */
export interface BriefRow {
  prId: string;
  headSha: string;
  json: unknown;
  provider: string | null;
  model: string | null;
  inputTokens: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  droppedRiskRefs: number;
  droppedFocusItems: number;
  droppedInputs: string[];
  generatedAt: Date;
}

/**
 * The module's own "stored json" contract for `pr_brief.json` — the `Brief`
 * fields plus a nested `input_status` (everything in `BriefInputStatus`
 * EXCEPT `dropped_inputs`, which has its own dedicated column and is
 * recombined on read). Re-parsed on every read AND write (AC-40) so a
 * corrupted or schema-drifted row degrades to `state: 'corrupt'` instead of
 * crashing the page (E-19) — same contract `onboarding.json` already has.
 */
export const StoredBriefJson = Brief.extend({
  input_status: BriefInputStatus.omit({ dropped_inputs: true }),
});
export type StoredBriefJson = z.infer<typeof StoredBriefJson>;

/**
 * Parse a persisted row into a full `BriefRecord`, or `null` when the JSON
 * is corrupted/schema-drifted (E-19) — never throws. Combines the `json`
 * blob with the dedicated usage/dropped-input columns.
 */
export function mapRowToRecord(row: BriefRow): BriefRecord | null {
  const parsedJson = StoredBriefJson.safeParse(row.json);
  if (!parsedJson.success) return null;

  const { input_status, ...brief } = parsedJson.data;
  const candidate = {
    ...brief,
    pr_id: row.prId,
    head_sha: row.headSha,
    generated_at: row.generatedAt.toISOString(),
    input_status: { ...input_status, dropped_inputs: row.droppedInputs ?? [] },
    usage: {
      provider: row.provider ?? '',
      model: row.model ?? '',
      input_tokens: row.inputTokens ?? 0,
      tokens_in: row.tokensIn,
      tokens_out: row.tokensOut,
      cost_usd: row.costUsd,
      dropped_risk_refs: row.droppedRiskRefs,
      dropped_focus_items: row.droppedFocusItems,
    },
  };
  const parsed = BriefRecord.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export interface ReadState {
  state: 'current' | 'stale' | 'absent' | 'corrupt';
  record: BriefRecord | null;
  reason: string | null;
}

const CORRUPT_REASON =
  'The stored brief could not be read (corrupted or from an older format) — regenerate to fix this.';

/**
 * The four READ states (AC-1/AC-17/E-19) — `currentRow` is the row for the
 * PR's CURRENT head SHA (or `undefined`); `latestRow` is the newest row for
 * ANY SHA (or `undefined`). Deliberately takes already-fetched rows, not a
 * repository, so it stays pure and independently testable.
 */
export function deriveBriefState(
  currentRow: BriefRow | undefined,
  latestRow: BriefRow | undefined,
): ReadState {
  if (currentRow) {
    const record = mapRowToRecord(currentRow);
    if (!record) return { state: 'corrupt', record: null, reason: CORRUPT_REASON };
    return { state: 'current', record, reason: null };
  }
  if (latestRow) {
    const record = mapRowToRecord(latestRow);
    if (!record) return { state: 'corrupt', record: null, reason: CORRUPT_REASON };
    return {
      state: 'stale',
      record,
      reason: `This brief describes an earlier commit (${latestRow.headSha}) — the PR has moved since it was generated.`,
    };
  }
  return { state: 'absent', record: null, reason: 'No brief has been generated for this PR yet.' };
}

/**
 * AC-33 — mark each entry whose `risk_level` differs from the entry BEFORE
 * it in the array (i.e. the next-OLDER entry, since callers pass
 * newest-first). The oldest entry has no older neighbour to compare against
 * and is never marked.
 */
export function markRiskChanges<T extends { risk_level: string }>(
  entriesNewestFirst: T[],
): (T & { risk_changed: boolean })[] {
  return entriesNewestFirst.map((entry, i) => {
    const older = entriesNewestFirst[i + 1];
    return { ...entry, risk_changed: older ? entry.risk_level !== older.risk_level : false };
  });
}

export interface InputStatusInputs {
  intentStatus: BriefInputStatus['intent_status'];
  blastStatus: BriefInputStatus['blast_status'];
  changedFileCount: number;
  specFilesUsed: string[];
  specFilesUnresolved: string[];
  linkedIssueStatus: BriefInputStatus['linked_issue_status'];
  droppedInputs: string[];
}

/** Assembles the `BriefInputStatus` the card's "Inputs" disclosure renders
 *  (UX-12) from the module's own generation-time facts — kept as one named
 *  builder rather than an inline object literal in `service.ts`. */
export function buildInputStatus(inputs: InputStatusInputs): BriefInputStatus {
  return {
    intent_status: inputs.intentStatus,
    blast_status: inputs.blastStatus,
    changed_file_count: inputs.changedFileCount,
    spec_files_used: inputs.specFilesUsed,
    spec_files_unresolved: inputs.specFilesUnresolved,
    linked_issue_status: inputs.linkedIssueStatus,
    dropped_inputs: inputs.droppedInputs,
  };
}
