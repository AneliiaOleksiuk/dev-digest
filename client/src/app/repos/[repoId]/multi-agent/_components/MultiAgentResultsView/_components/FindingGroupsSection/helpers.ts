/* FindingGroupsSection/helpers.ts — pure helpers: a stable per-group key
   (groups have no persisted id, they're derived at read time — AC-22..25)
   and reconstructing a FindingCard-shaped `FindingRecord` for one group
   member, preferring the REAL persisted finding (accept/dismiss state intact)
   over the group-projection fields. */
import type { FindingGroup, FindingGroupMember, FindingRecord } from "@devdigest/shared";

export function groupKey(group: FindingGroup): string {
  return `${group.normalized_file}:${group.start_line}-${group.end_line}:${group.category}`;
}

/**
 * Prefer the real, persisted `FindingRecord` (correct `accepted_at`/
 * `dismissed_at`, straight from `usePrReviews`) when it's in the lookup map.
 * Falls back to reconstructing one from the group + member projection fields
 * (title/rationale/suggestion/confidence VERBATIM, per-member — never merged)
 * for the rare case the reviews cache hasn't caught up yet.
 */
export function memberFindingRecord(
  group: FindingGroup,
  member: FindingGroupMember,
  findingsById: Map<string, FindingRecord>,
): FindingRecord {
  const existing = findingsById.get(member.id);
  if (existing) return existing;
  return {
    id: member.id,
    severity: member.severity,
    category: group.category,
    title: member.title,
    file: group.file,
    start_line: group.start_line,
    end_line: group.end_line,
    rationale: member.rationale,
    suggestion: member.suggestion ?? null,
    confidence: member.confidence,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: member.run_id,
    accepted_at: null,
    dismissed_at: null,
  };
}
