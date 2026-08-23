"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Tabs } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { ContextTab } from "./_components/ContextTab";
import { OverviewTab } from "./_components/OverviewTab";
import { VersionHistoryTab } from "./_components/VersionHistoryTab";
import { PREVIEW_TABS } from "./constants";
import { s } from "./styles";

export function SkillPreview({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const [tab, setTab] = React.useState<string>("overview");
  const tabs = PREVIEW_TABS.map((tb) => ({ key: tb.key, label: t(tb.labelKey), icon: tb.icon }));

  return (
    <div style={s.panel}>
      <div style={s.headerRow}>
        <h2 style={s.title}>{skill.name}</h2>
        <Badge mono>{t("preview.version", { version: skill.version })}</Badge>
      </div>
      <div style={s.tabsBar}>
        <Tabs tabs={tabs} value={tab} onChange={setTab} pad="0 24px" />
      </div>
      <div style={s.content}>
        {tab === "history" ? (
          <VersionHistoryTab skill={skill} />
        ) : tab === "context" ? (
          <ContextTab skill={skill} />
        ) : (
          <OverviewTab skill={skill} />
        )}
      </div>
    </div>
  );
}
