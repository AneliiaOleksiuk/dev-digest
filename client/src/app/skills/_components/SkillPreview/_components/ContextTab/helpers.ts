import type { ContextAttachment, ContextDocument } from "@devdigest/shared";

/** Attached paths first (in persisted order), then every other discovered
 *  document in listing order — the same "linked-first, then the rest"
 *  shape `SkillsTab/helpers.ts`'s `buildOrderedSkillIds` already uses. */
export function buildOrderedPaths(documents: ContextDocument[], attached: ContextAttachment[]): string[] {
  const attachedInOrder = [...attached].sort((a, b) => a.order - b.order).map((a) => a.path);
  const attachedSet = new Set(attachedInOrder);
  const unattached = documents.filter((d) => !attachedSet.has(d.path)).map((d) => d.path);
  return [...attachedInOrder, ...unattached];
}

/** Plain-text match over path/type — same rule as the standalone Project
 *  Context page's filter (never a glob/SQL fragment). */
export function matchesQuery(doc: ContextDocument | undefined, path: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (!doc) return path.toLowerCase().includes(q);
  return doc.path.toLowerCase().includes(q) || doc.type.toLowerCase().includes(q);
}
