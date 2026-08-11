"use client";

import React from "react";
import { IntentCard } from "../IntentCard";
import { BlastRadiusCard } from "../BlastRadiusCard";
import { PrBriefBanner } from "./_components/PrBriefBanner";
import { s } from "./styles";

interface OverviewTabProps {
  prId: string;
  headSha: string;
  /** github.com "owner/repo" — null until the repo is loaded; threaded down to
   *  BlastRadiusCard → BlastPanel for the caller `file:line` GitHub links. */
  repoFullName: string | null;
  /** Route param, threaded down to BlastRadiusCard → BlastPanel → PriorPrs
   *  for the internal `/repos/:repoId/pulls/:number` prior-PR links. */
  repoId: string;
  /** True once GET /pulls/:id has completed (pr_files synced). */
  blastReady?: boolean;
}

/**
 * Overview: PR Brief full width, then Intent | Blast side-by-side (design
 * mock). Blast is column-narrow-safe (inline stats, no nested wide grids).
 */
export function OverviewTab({
  prId,
  headSha,
  repoFullName,
  repoId,
  blastReady = true,
}: OverviewTabProps) {
  return (
    <>
      <PrBriefBanner prId={prId} />
      <div style={s.intentBlastRow}>
        <IntentCard prId={prId} headSha={headSha} />
        <BlastRadiusCard
          prId={prId}
          repoFullName={repoFullName}
          headSha={headSha}
          repoId={repoId}
          blastReady={blastReady}
        />
      </div>
    </>
  );
}
