"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Badge, Donut, EmptyState, ErrorState, Icon, MetricCard, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useAgentPerf } from "@/lib/hooks/agent-performance";
import { isIncompleteCustomRange, rangeFromSearchParams, rangeToSearchParams, validateCustomRange } from "@/lib/hooks/range";
import { formatCost } from "@/helpers/format";
import { RangeSelector } from "@/components/range-selector";
import {
  acceptRateColor,
  agentDetailHref,
  findAgentById,
  formatDurationMs,
  formatLastRunAt,
  formatPercent,
  pooledDecided,
  rankByAcceptRate,
  withDonutColors,
} from "./helpers";
import { s } from "./styles";

/**
 * SPEC-06 WI11 — the workspace-wide Agent Performance dashboard
 * (`GET /agents/performance`, via `useAgentPerf`). Same `/ci-runs` shape:
 * thin `page.tsx` → this view owns fetch/state/render. AC-33/AC-34/AC-35/
 * NFR-7: loading renders no number, failure renders no tiles/table/donuts,
 * and a whole-workspace empty range (AC-36) is visually distinct from a
 * populated table with a zero-run agent row (AC-37). No write action
 * anywhere on this page (AC-39).
 */
export function AgentPerformanceView() {
  const t = useTranslations("agentPerformance");
  const router = useRouter();
  const search = useSearchParams();

  const range = rangeFromSearchParams(search);
  const setRange = (next: typeof range) => {
    router.replace(`/agent-performance?${rangeToSearchParams(search, next).toString()}`);
  };

  const { data, isLoading, isError, refetch } = useAgentPerf(range);

  const rangeLabels = {
    "1d": t("range.1d"),
    "30d": t("range.30d"),
    custom: t("range.custom"),
    customFrom: t("range.customFrom"),
    customTo: t("range.customTo"),
  };

  // fix-loop (A2) — a custom range with only one date entered never reaches
  // the server (useAgentPerf's `enabled` guard) — surface real validation
  // copy instead of the generic error state or a silent blank page.
  const rangeIncomplete = isIncompleteCustomRange(range);
  // fix-loop (Row 12/AC-4) — a COMPLETE custom range that's invalid
  // (start > end, span > 366 days) also never reaches the server (same
  // `enabled` guard, `validateCustomRange`) — without this the generic
  // `loadError` would render for what is really a validation failure.
  const rangeError = validateCustomRange(range);
  const wholeWorkspaceEmpty = !!data && data.summary.runs === 0;
  const mostActiveRow = data ? findAgentById(data.agents, data.summary.most_active_agent_id) : undefined;
  const grouped = data ? rankByAcceptRate(data.agents) : null;
  const pooled = data ? pooledDecided(data.agents) : null;

  return (
    <AppShell crumb={[{ label: t("title") }]}>
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>{t("title")}</h1>
            <p style={s.subtitle}>{t("subtitle")}</p>
          </div>
          <RangeSelector value={range} onChange={setRange} labels={rangeLabels} />
        </div>

        {isLoading && (
          <>
            <div style={s.tiles}>
              <Skeleton height={90} />
              <Skeleton height={90} />
              <Skeleton height={90} />
              <Skeleton height={90} />
            </div>
            <Skeleton height={220} />
          </>
        )}

        {!isLoading && !rangeIncomplete && !rangeError && isError && (
          <ErrorState body={t("loadError")} onRetry={() => refetch()} />
        )}

        {/* fix-loop (A2) — real validation copy for a half-entered custom
            range, instead of the generic error state or a silent blank
            page (the query stays disabled until both dates are set). */}
        {!isLoading && rangeIncomplete && <p style={s.rangeIncomplete}>{t("range.incomplete")}</p>}

        {/* fix-loop (Row 12/AC-4) — real validation copy for a COMPLETE but
            invalid range (start > end, or span > 366 days), instead of
            firing the request and rendering the generic `loadError` when the
            server 422s. */}
        {!isLoading && !rangeIncomplete && rangeError && (
          <p style={s.rangeIncomplete}>
            {rangeError === "startAfterEnd" ? t("range.invalidOrder") : t("range.invalidSpan")}
          </p>
        )}

        {!isLoading && !rangeIncomplete && !rangeError && !isError && wholeWorkspaceEmpty && (
          <EmptyState icon="BarChart" title={t("empty.title")} body={t("empty.body")} />
        )}

        {!isLoading && !rangeIncomplete && !rangeError && !isError && data && !wholeWorkspaceEmpty && grouped && pooled && (
          <>
            <div style={s.tiles}>
              <MetricCard
                label={t("summary.totalRuns")}
                value={data.summary.runs}
                trend={data.summary.runs_trend}
              />
              <div>
                <MetricCard label={t("summary.totalCost")} value={formatCost(data.summary.total_cost_usd)} />
                <div style={s.tileSubtitle}>{t("summary.totalCostSubtitle")}</div>
                {data.summary.total_cost_partial && (
                  <div style={s.partialBadge}>{t("summary.partialCost")}</div>
                )}
              </div>
              <div>
                <MetricCard label={t("summary.avgAcceptRate")} value={formatPercent(data.summary.avg_accept_rate)} />
                {/* A1/AC-25/US-5 — the decided-findings denominator, summed
                    client-side from AgentPerfRow.accepted/.dismissed (no
                    contract change needed). */}
                {pooled.decided > 0 && (
                  <div style={s.tileSubtitle}>
                    {t("summary.avgAcceptRateDenominator", {
                      accepted: pooled.accepted,
                      decided: pooled.decided,
                    })}
                  </div>
                )}
              </div>
              <div>
                <MetricCard label={t("summary.mostActive")} value={data.summary.most_active_agent ?? "—"} />
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

            <div style={s.donutRow}>
              <div style={s.donutCard}>
                <div style={s.donutTitle}>{t("costByAgent")}</div>
                {data.cost_by_agent.length > 0 ? (
                  <Donut segments={withDonutColors(data.cost_by_agent)} />
                ) : (
                  <div style={s.noCost}>{t("noCost")}</div>
                )}
              </div>
              <div style={s.donutCard}>
                <div style={s.donutTitle}>{t("costByModel")}</div>
                {data.cost_by_model.length > 0 ? (
                  <Donut segments={withDonutColors(data.cost_by_model)} />
                ) : (
                  <div style={s.noCost}>{t("noCost")}</div>
                )}
              </div>
            </div>

            <div style={s.section}>
              <div style={s.sectionTitle}>{t("perAgent")}</div>
              {/* C1 fix-loop — ONE <table> with two <tbody> sections (ranked,
                  then low-confidence behind a spanning group-label row),
                  instead of two separate <table> elements that can't share
                  column sizing. A single table sizes its columns from the
                  UNION of every row in it, so the ranked and low-confidence
                  sections' columns align by construction — no
                  `tableLayout: fixed` / matching-width bookkeeping needed. */}
              <div style={s.tableWrap}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th}>{t("table.agent")}</th>
                      <th style={s.th}>{t("table.runs")}</th>
                      <th style={s.th}>{t("table.avgCost")}</th>
                      <th style={s.th}>{t("table.avgDuration")}</th>
                      <th style={s.th}>{t("table.accept")}</th>
                      <th style={s.th}>{t("table.lastRun")}</th>
                      <th style={s.th} />
                    </tr>
                  </thead>
                  <tbody>
                    {grouped.ranked.map((row) => (
                      <tr key={row.agent_id}>
                        <td style={s.td}>
                          <span style={s.agentCell}>
                            <span style={s.agentIcon}>
                              <Icon.Cpu size={12} />
                            </span>
                            {row.agent_name}
                          </span>
                        </td>
                        <td style={s.td}>{row.runs}</td>
                        <td style={s.td}>{formatCost(row.avg_cost_usd)}</td>
                        <td style={s.td}>{formatDurationMs(row.avg_latency_ms)}</td>
                        <td style={s.td}>
                          <span style={{ color: acceptRateColor(row.accept_rate) }}>
                            {formatPercent(row.accept_rate)}
                          </span>
                        </td>
                        <td style={s.td}>{formatLastRunAt(row.last_run_at)}</td>
                        <td style={s.td}>
                          <Link href={agentDetailHref(row.agent_id, range)}>{t("view")}</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>

                  {grouped.lowConfidence.length > 0 && (
                    <tbody>
                      <tr>
                        <td style={s.groupLabelCell} colSpan={7}>
                          {t("lowConfidenceGroup")}
                        </td>
                      </tr>
                      {grouped.lowConfidence.map((row) => (
                        <tr key={row.agent_id}>
                          <td style={s.td}>
                            <span style={s.agentCell}>
                              <span style={s.agentIcon}>
                                <Icon.Cpu size={12} />
                              </span>
                              {row.agent_name}
                              {row.runs === 0 && (
                                <Badge color="var(--text-muted)">{t("zeroRuns")}</Badge>
                              )}
                            </span>
                          </td>
                          <td style={s.td}>{row.runs}</td>
                          <td style={s.td}>{formatCost(row.avg_cost_usd)}</td>
                          <td style={s.td}>{formatDurationMs(row.avg_latency_ms)}</td>
                          <td style={s.td}>
                            <span style={{ color: acceptRateColor(row.accept_rate) }}>
                              {formatPercent(row.accept_rate)}
                            </span>
                          </td>
                          <td style={s.td}>{formatLastRunAt(row.last_run_at)}</td>
                          <td style={s.td}>
                            <Link href={agentDetailHref(row.agent_id, range)}>{t("view")}</Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  )}
                </table>
              </div>

              {grouped.allLowConfidence && grouped.lowConfidence.length > 0 && (
                <p style={s.muted}>{t("notRankable")}</p>
              )}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
