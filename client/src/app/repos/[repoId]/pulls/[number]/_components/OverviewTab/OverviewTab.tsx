"use client";

import React from "react";
import { IntentCard } from "../IntentCard";
import { BlastRadiusCard } from "../BlastRadiusCard";
import { PrBriefBanner } from "./_components/PrBriefBanner";
import { s } from "./styles";

interface OverviewTabProps {
  prId: string;
  headSha: string;
}

/**
 * 3-panel Overview (docs/plans/intent-layer.md WI13): PR Brief banner full
 * width on top, Intent | Blast Radius as a 1fr 1fr row below it (stacking
 * under ~900px via `s.intentBlastRow`). No Description panel — mock has
 * only the three panels; PR body is not a fourth Overview surface.
 */
export function OverviewTab({ prId, headSha }: OverviewTabProps) {
  return (
    <>
      <PrBriefBanner prId={prId} />
      <div style={s.intentBlastRow}>
        <IntentCard prId={prId} headSha={headSha} />
        <BlastRadiusCard />
      </div>
    </>
  );
}
