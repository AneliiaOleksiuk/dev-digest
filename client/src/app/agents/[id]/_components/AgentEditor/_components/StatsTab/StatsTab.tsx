"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, MetricCard, Sparkline, SeverityBadge, Skeleton } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { useAgentDetailStats } from "@/lib/hooks/agents";
import { rangeFromSearchParams } from "@/lib/hooks/range";
import { formatCost } from "@/helpers/format";
import { RangeSelector } from "@/components/range-selector";
import { formatDurationMs, formatPercent } from "./helpers";
import { s } from "./styles";

/**
 * SPEC-06 WI9 — the Stats tab (`GET /agents/:id/stats`, via
 * `useAgentDetailStats`). `?tab=stats&range=` survives a cold reload —
 * `page.tsx`'s `setTab` already preserves every other query param, and this
 * component owns `range`/`start`/`end` itself (AC-6).
 *
 * AC-33/AC-34/NFR-7: three visually distinct states, and the loading state
 * renders NO numeric value — no zeros, no dashes-as-data, no stale-but-
 * unlabeled figures. Cost is always labeled an estimate (AC-26, G-5), never
 * billed/actual. No write action of any kind (AC-39).
 */
export function StatsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const router = useRouter();
  const search = useSearchParams();

  const range = rangeFromSearchParams(search);
  const setRange = (next: typeof range) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("range", next.range ?? "30d");
    if (next.range === "custom") {
      if (next.start) sp.set("start", next.start);
      else sp.delete("start");
      if (next.end) sp.set("end", next.end);
      else sp.delete("end");
    } else {
      sp.delete("start");
      sp.delete("end");
    }
    router.replace(`/agents/${agent.id}?${sp.toString()}`);
  };

  const { data: stats, isLoading, isError, refetch } = useAgentDetailStats(agent.id, range);

  const rangeLabels = {
    "1d": t("stats.range.1d"),
    "30d": t("stats.range.30d"),
    custom: t("stats.range.custom"),
    customFrom: t("stats.range.customFrom"),
    customTo: t("stats.range.customTo"),
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div>
          <h3 style={s.title}>{t("stats.title")}</h3>
          <p style={s.subtitle}>{t("stats.subtitle")}</p>
        </div>
        <RangeSelector value={range} onChange={setRange} labels={rangeLabels} />
      </div>

      {isLoading && (
        <div style={s.skeletons}>
          <Skeleton height={90} />
          <Skeleton height={60} />
          <Skeleton height={120} />
        </div>
      )}

      {!isLoading && isError && (
        <ErrorState body={t("stats.loadError")} onRetry={() => refetch()} />
      )}

      {!isLoading && !isError && stats && stats.runs === 0 && (
        <EmptyState icon="BarChart" title={t("stats.empty.title")} body={t("stats.empty.body")} />
      )}

      {!isLoading && !isError && stats && stats.runs > 0 && (
        <>
          <div style={s.tiles}>
            <MetricCard label={t("stats.runs")} value={stats.runs} />
            <MetricCard label={t("stats.cost")} value={formatCost(stats.avg_cost_usd)} />
            <MetricCard label={t("stats.avgLatency")} value={formatDurationMs(stats.avg_latency_ms)} />
          </div>
          <p style={s.note}>{t("stats.costNote")}</p>

          <div style={s.section}>
            <div style={s.sectionTitle}>{t("stats.acceptRate")}</div>
            <div style={s.acceptRow}>
              <span style={s.acceptValue}>{formatPercent(stats.accept_rate)}</span>
              <span style={s.acceptDenominator}>
                {t("stats.acceptRateDenominator", {
                  accepted: stats.accepted,
                  decided: stats.accepted + stats.dismissed,
                })}
              </span>
            </div>
            <p style={s.note}>{t("stats.acceptRateLive")}</p>
          </div>

          <div style={s.section}>
            <div style={s.sectionTitle}>{t("stats.severity.title")}</div>
            <div style={s.severityRow}>
              <SeverityBadge severity="CRITICAL" count={stats.findings_by_severity.CRITICAL} />
              <SeverityBadge severity="WARNING" count={stats.findings_by_severity.WARNING} />
              <SeverityBadge severity="SUGGESTION" count={stats.findings_by_severity.SUGGESTION} />
            </div>
          </div>

          <div style={s.section}>
            <div style={s.sectionTitle}>{t("stats.trend")}</div>
            <div style={s.trendWrap}>
              <Sparkline data={stats.trend.map((p) => p.value)} w={200} h={40} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
