import type { ContextAttachmentSet, ContextDocument, Skill } from "@devdigest/shared";

/**
 * Documents inherited from the agent's ENABLED linked skills, deduped by
 * path (a document from two enabled skills is still one inherited row) —
 * same enabled-only rule the run applies (AC-15/E-7). Value = the first
 * skill's name, for the "via <skill>" label (UX-4).
 */
export function buildInheritedMap(
  enabledLinkedSkillIds: string[],
  skillContexts: (ContextAttachmentSet | undefined)[],
  skillsById: Map<string, Skill>,
): Map<string, string> {
  const inherited = new Map<string, string>();
  enabledLinkedSkillIds.forEach((skillId, i) => {
    const ctx = skillContexts[i];
    if (!ctx) return;
    const skillName = skillsById.get(skillId)?.name ?? "";
    for (const doc of ctx.documents) {
      if (!inherited.has(doc.path)) inherited.set(doc.path, skillName);
    }
  });
  return inherited;
}

/** Effective-set token total: inherited ∪ direct, deduped by path (D-1/
 *  AC-14 parity — a document attached both ways is billed once). */
export function effectiveTotalTokens(
  inheritedPaths: Iterable<string>,
  directPaths: Iterable<string>,
  docsByPath: Map<string, ContextDocument>,
): number {
  const paths = new Set<string>([...inheritedPaths, ...directPaths]);
  let total = 0;
  for (const path of paths) total += docsByPath.get(path)?.tokens ?? 0;
  return total;
}

export function matchesQuery(doc: ContextDocument | undefined, path: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (!doc) return path.toLowerCase().includes(q);
  return doc.path.toLowerCase().includes(q) || doc.type.toLowerCase().includes(q);
}
