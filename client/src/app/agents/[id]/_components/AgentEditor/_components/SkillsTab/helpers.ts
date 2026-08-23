import type { AgentSkillLink, Skill, SkillType } from "@devdigest/shared";

/** Ordered skill ids for the tab: linked skills first (in their saved order), then
 *  every other workspace skill appended in list order. */
export function buildOrderedSkillIds(skills: Skill[], links: AgentSkillLink[]): string[] {
  const linkedIdsInOrder = [...links].sort((a, b) => a.order - b.order).map((link) => link.skill_id);
  const linkedIdSet = new Set(linkedIdsInOrder);
  const unlinkedIds = skills.filter((skill) => !linkedIdSet.has(skill.id)).map((skill) => skill.id);
  return [...linkedIdsInOrder, ...unlinkedIds];
}

const TYPE_BADGE_COLORS: Record<SkillType, { color: string; bg: string }> = {
  rubric: { color: "var(--accent)", bg: "var(--accent-bg)" },
  security: { color: "var(--crit)", bg: "var(--crit-bg)" },
  convention: { color: "var(--text-secondary)", bg: "var(--bg-hover)" },
  custom: { color: "var(--text-muted)", bg: "var(--bg-hover)" },
};

export function typeBadgeColor(type: SkillType): { color: string; bg: string } {
  return TYPE_BADGE_COLORS[type];
}
