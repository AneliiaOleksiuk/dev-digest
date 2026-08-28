"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Donut } from "@devdigest/ui";
import type { PerfCostSegment } from "@devdigest/shared";
import { withDonutColors } from "../../helpers";
import { s } from "../../styles";

/**
 * AgentPerformanceView's two cost donuts (cost-by-agent, cost-by-model).
 * Extracted verbatim from AgentPerformanceView's populated-state branch —
 * pure structural split, no behavior change. `withDonutColors` remains the
 * single place presentation colors get attached (E-4/D-9 — the contract
 * itself carries no color).
 */
export function CostDonuts({
  costByAgent,
  costByModel,
}: {
  costByAgent: PerfCostSegment[];
  costByModel: PerfCostSegment[];
}) {
  const t = useTranslations("agentPerformance");
  return (
    <div style={s.donutRow}>
      <div style={s.donutCard}>
        <div style={s.donutTitle}>{t("costByAgent")}</div>
        {costByAgent.length > 0 ? (
          <Donut segments={withDonutColors(costByAgent)} />
        ) : (
          <div style={s.noCost}>{t("noCost")}</div>
        )}
      </div>
      <div style={s.donutCard}>
        <div style={s.donutTitle}>{t("costByModel")}</div>
        {costByModel.length > 0 ? (
          <Donut segments={withDonutColors(costByModel)} />
        ) : (
          <div style={s.noCost}>{t("noCost")}</div>
        )}
      </div>
    </div>
  );
}
