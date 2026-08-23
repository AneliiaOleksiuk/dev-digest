"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Checkbox, Icon } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { isUntrustedSource } from "../../../../../../../../../lib/skill-trust";
import { typeBadgeColor } from "../../helpers";
import { s } from "./styles";

export function SkillRow({
  skill,
  linked,
  onToggle,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  skill: Skill;
  linked: boolean;
  onToggle: () => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
}) {
  // "skills" namespace — reuses the same vetting copy as the Skills Lab's
  // SkillCard so the warning reads identically in both places.
  const t = useTranslations("skills");
  const badgeColor = typeBadgeColor(skill.type);
  const needsVetting = !skill.enabled && isUntrustedSource(skill);
  return (
    <div draggable onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} style={s.row}>
      <Icon.Menu size={14} style={s.dragHandle} />
      <Checkbox checked={linked} onChange={onToggle} />
      <span style={s.name}>{skill.name}</span>
      {needsVetting && (
        <span title={t("listItem.vettingTitle")}>
          <Badge color="var(--warn)" icon="AlertTriangle">
            {t("listItem.needsVetting")}
          </Badge>
        </span>
      )}
      <Badge color={badgeColor.color} bg={badgeColor.bg}>
        {skill.type}
      </Badge>
    </div>
  );
}
