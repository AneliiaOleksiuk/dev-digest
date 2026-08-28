"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { MetricCard } from "@devdigest/ui";
import type { AgentPerf, AgentPerfRow } from "@devdigest/shared";
import { formatCost, formatPercent } from "@/helpers/format";
import { s } from "../../styles";

/**
 * AgentPerformanceView's four summary tiles: Total runs, Total cost, Avg
 * accept rate (A1/AC-25/US-5 — pooled-decided denominator), Most-active agent
 * (D-5/E-5 — resolved by id, never re-derived from the non-unique name).
 * Extracted verbatim from AgentPerformanceView's populated-state branch —
 * pure structural split, no behavior change.
 */
export function SummaryTiles({
  summary,
  pooled,
  mostActiveRow,
}: {
  summary: AgentPerf["summary"];
  pooled: { accepted: number; decided: number };
  mostActiveRow: AgentPerfRow | undefined;
}) {
  const t = useTranslations("agentPerformance");
  return (
    <div style={s.tiles}>
      <MetricCard label={t("summary.totalRuns")} value={summary.runs} trend={summary.runs_trend} />
      <div>
        <MetricCard label={t("summary.totalCost")} value={formatCost(summary.total_cost_usd)} />
        <div style={s.tileSubtitle}>{t("summary.totalCostSubtitle")}</div>
        {summary.total_cost_partial && <div style={s.partialBadge}>{t("summary.partialCost")}</div>}
      </div>
      <div>
        <MetricCard label={t("summary.avgAcceptRate")} value={formatPercent(summary.avg_accept_rate)} />
        {/* A1/AC-25/US-5 — the decided-findings denominator, summed
            client-side from AgentPerfRow.accepted/.dismissed (no contract
            change needed). */}
        {pooled.decided > 0 && (
          <div style={s.tileSubtitle}>
            {t("summary.avgAcceptRateDenominator", { accepted: pooled.accepted, decided: pooled.decided })}
          </div>
        )}
      </div>
      <div>
        <MetricCard label={t("summary.mostActive")} value={summary.most_active_agent ?? "—"} />
        {mostActiveRow && (
          <div style={s.mostActiveSub}>
            {t("summary.mostActiveDetail", {
              runs: mostActiveRow.runs,
              acceptRate: formatPercent(mostActiveRow.accept_rate),
            })}
          </div>
        )}
      </div>
    </div>
  );
}
