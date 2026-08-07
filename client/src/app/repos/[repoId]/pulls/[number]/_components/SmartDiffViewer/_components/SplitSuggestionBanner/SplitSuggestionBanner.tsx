"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { ProposedSplit } from "@devdigest/shared";
import { s } from "../../styles";

export function SplitSuggestionBanner({
  totalLines,
  proposedSplits,
}: {
  totalLines: number;
  proposedSplits: ProposedSplit[];
}) {
  const t = useTranslations("prReview");

  const splitLabel = (name: string) => {
    if (name === "core" || name === "wiring" || name === "boilerplate") {
      return t(`smartDiff.split.${name}`);
    }
    return name;
  };

  return (
    <div style={s.banner} role="status">
      <div style={s.bannerTitle}>{t("smartDiff.largeTitle", { lines: totalLines })}</div>
      <div style={s.bannerBody}>{t("smartDiff.largeBody")}</div>
      {proposedSplits.length > 0 && (
        <ul style={s.splitList}>
          {proposedSplits.map((split) => (
            <li key={split.name} style={s.splitItem}>
              <strong>{splitLabel(split.name)}</strong>
              {" — "}
              {t("smartDiff.filesCount", { count: split.files.length })}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
