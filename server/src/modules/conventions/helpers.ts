import type { ConventionCandidate, ConventionStatus } from '@devdigest/shared';
import type { ConventionRow } from './repository.js';

/** Map a persisted convention row to the public `ConventionCandidate` DTO. */
export function toConventionDto(row: ConventionRow): ConventionCandidate {
  return {
    id: row.id,
    category: row.category,
    rule: row.rule,
    evidence_path: row.evidencePath ?? '',
    evidence_snippet: row.evidenceSnippet ?? '',
    evidence_line: row.evidenceLine,
    confidence: row.confidence ?? 0,
    status: row.status as ConventionStatus,
    skill_id: row.skillId,
  };
}
