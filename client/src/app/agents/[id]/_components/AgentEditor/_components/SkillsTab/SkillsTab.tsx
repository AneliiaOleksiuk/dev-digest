"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { useAgentSkills, useSetAgentSkills } from "../../../../../../../lib/hooks/agents";
import { useSkills } from "../../../../../../../lib/hooks/skills";
import { SkillRow } from "./_components/SkillRow";
import { buildOrderedSkillIds } from "./helpers";
import { s } from "./styles";

export function SkillsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const { data: allSkills } = useSkills();
  const { data: links } = useAgentSkills(agent.id);
  const setAgentSkills = useSetAgentSkills();

  const [filter, setFilter] = React.useState("");
  const draggedId = React.useRef<string | null>(null);

  // Derived, not stored: `links` already reflects the optimistic write from
  // useSetAgentSkills' onMutate immediately after a toggle/reorder, so there
  // is no separate local copy to fall out of sync with a refetch.
  const orderedIds = React.useMemo(
    () => (allSkills && links ? buildOrderedSkillIds(allSkills, links) : []),
    [allSkills, links],
  );
  const linkedIds = React.useMemo(
    () => new Set((links ?? []).map((link) => link.skill_id)),
    [links],
  );

  const persist = (nextOrderedIds: string[], nextLinkedIds: Set<string>) => {
    const skillIds = nextOrderedIds.filter((id) => nextLinkedIds.has(id));
    setAgentSkills.mutate({ agentId: agent.id, skillIds });
  };

  const toggle = (skillId: string) => {
    const next = new Set(linkedIds);
    if (next.has(skillId)) next.delete(skillId);
    else next.add(skillId);
    persist(orderedIds, next);
  };

  const reorder = (targetId: string) => {
    const draggedSkillId = draggedId.current;
    if (!draggedSkillId || draggedSkillId === targetId) return;
    const next = orderedIds.filter((id) => id !== draggedSkillId);
    const targetIndex = next.indexOf(targetId);
    next.splice(targetIndex, 0, draggedSkillId);
    persist(next, linkedIds);
  };

  if (!allSkills || !links) return null;

  const skillsById = new Map(allSkills.map((skill) => [skill.id, skill]));
  const visibleIds = orderedIds.filter((id) => {
    const skill = skillsById.get(id);
    return skill && skill.name.toLowerCase().includes(filter.trim().toLowerCase());
  });

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.title}>{t("skills.title")}</h2>
        <Badge color="var(--accent)">
          {t("skills.enabledCount", { linked: linkedIds.size, total: allSkills.length })}
        </Badge>
      </div>
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={t("skills.filterPlaceholder")}
        style={s.filterInput}
      />
      <p style={s.orderHint}>{t("skills.orderHint")}</p>
      <div style={s.list}>
        {visibleIds.map((id) => (
          <SkillRow
            key={id}
            skill={skillsById.get(id)!}
            linked={linkedIds.has(id)}
            onToggle={() => toggle(id)}
            onDragStart={() => (draggedId.current = id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => reorder(id)}
          />
        ))}
      </div>
    </div>
  );
}
