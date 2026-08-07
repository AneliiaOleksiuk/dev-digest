/* BlastRadiusCard — right column of the 3-panel Overview row (WI13).
   No GET /blast-radius endpoint exists yet — only the unbuilt `BlastRadius`
   contract in brief.ts. This card ALWAYS renders the honest "unavailable"
   empty state; it must never fabricate a symbol/caller/endpoint tree. Full
   blast-radius compute + API is a follow-on (see docs/plans/intent-layer.md
   WI13 Deviations note). Title lives INSIDE the bordered card (mock parity). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import { s } from "./styles";

export function BlastRadiusCard() {
  const t = useTranslations("brief");

  return (
    <section style={s.wrap}>
      <div style={s.cardTitle}>
        <Icon.GitBranch size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
        <span style={s.cardTitleText}>{t("block.blast")}</span>
      </div>
      <div style={s.empty}>
        <div style={s.emptyTitle}>{t("unavailable")}</div>
        <div style={s.emptyBody}>{t("unavailableHint")}</div>
      </div>
    </section>
  );
}
