/* BlastRadiusCard — right column of the Intent | Blast Overview row.
   Card chrome only (title); BlastPanel owns the useBlastRadius fetch and
   all body states including degraded-with-reason. Full inline tree matches
   the design mock (L04 acceptance fix). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import { BlastPanel } from "./_components/BlastPanel";
import { s } from "./styles";

export function BlastRadiusCard({
  prId,
  repoFullName,
  headSha,
  repoId,
  blastReady = true,
}: {
  prId: string;
  /** github.com "owner/repo" — null until the repo is loaded (no link, plain text). */
  repoFullName: string | null;
  headSha: string;
  repoId: string;
  /** False until GET /pulls/:id has finished (so pr_files are synced). */
  blastReady?: boolean;
}) {
  const t = useTranslations("brief");

  return (
    <section style={s.wrap}>
      <div style={s.cardTitle}>
        <Icon.GitBranch size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
        <span style={s.cardTitleText}>{t("block.blast")}</span>
      </div>

      <BlastPanel
        prId={prId}
        repoFullName={repoFullName}
        headSha={headSha}
        repoId={repoId}
        enabled={blastReady}
      />
    </section>
  );
}
