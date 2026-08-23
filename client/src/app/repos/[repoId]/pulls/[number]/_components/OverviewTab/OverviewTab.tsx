"use client";

import React from "react";
import { IntentCard } from "../IntentCard";
import { BlastRadiusCard } from "../BlastRadiusCard";
import { PrBriefCard } from "./_components/PrBriefCard";
import type { FocusDiffLineOptions } from "@/lib/types";
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
  /** The PR's currently-loaded changed-file paths — PrBriefCard checks
   *  membership before navigating a review-focus click (AC-31): a focus
   *  entry whose file isn't here (PR advanced past the brief's head_sha, or
   *  a historical brief from the Why Timeline) degrades instead. */
  changedFilePaths: string[];
  /** Deep-links a review-focus entry into the Files-changed tab (SPEC-03
   *  AC-30), from `page.tsx`'s `?file=&line=` params. */
  onFocusDiffLine: (opts: FocusDiffLineOptions) => void;
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
  changedFilePaths,
  onFocusDiffLine,
}: OverviewTabProps) {
  return (
    <>
      <PrBriefCard
        prId={prId}
        headSha={headSha}
        changedFilePaths={changedFilePaths}
        onFocusDiffLine={onFocusDiffLine}
      />
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
