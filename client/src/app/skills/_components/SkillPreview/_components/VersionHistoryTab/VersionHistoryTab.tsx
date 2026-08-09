"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Markdown, Skeleton, ErrorState } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkillVersions } from "../../../../../../lib/hooks/skills";
import { s } from "./styles";

export function VersionHistoryTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const { data: versions, isLoading, isError, refetch } = useSkillVersions(skill.id);
  const [selected, setSelected] = React.useState<number | null>(null);

  const active = versions?.find((v) => v.version === selected) ?? versions?.[0];

  if (isLoading) {
    return (
      <>
        <Skeleton height={40} />
        <Skeleton height={40} />
      </>
    );
  }
  if (isError) return <ErrorState body={t("preview.history.loadError")} onRetry={() => refetch()} />;
  if (!versions || versions.length === 0) return <p style={s.empty}>{t("preview.history.empty")}</p>;

  return (
    <div style={s.wrap}>
      <div style={s.list}>
        {versions.map((v) => (
          <button
            key={v.version}
            style={{ ...s.item, ...(v.version === active?.version ? s.itemActive : {}) }}
            onClick={() => setSelected(v.version)}
          >
            <Badge mono>{t("preview.version", { version: v.version })}</Badge>
            <span style={s.meta}>
              {t("preview.history.createdAt", { date: new Date(v.created_at).toLocaleString() })}
            </span>
            {v.version === skill.version && <span style={s.meta}>{t("preview.history.current")}</span>}
          </button>
        ))}
      </div>
      {active && (
        <div style={s.body}>
          <Markdown>{active.body}</Markdown>
        </div>
      )}
    </div>
  );
}
