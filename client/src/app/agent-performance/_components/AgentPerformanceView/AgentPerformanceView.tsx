"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Badge, Donut, EmptyState, ErrorState, Icon, MetricCard, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useAgentPerf } from "@/lib/hooks/agent-performance";
import { isIncompleteCustomRange, rangeFromSearchParams } from "@/lib/hooks/range";
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
    router.replace(`/agent-performance?${sp.toString()}`);
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

        {!isLoading && !rangeIncomplete && isError && (
          <ErrorState body={t("loadError")} onRetry={() => refetch()} />
        )}

        {/* fix-loop (A2) — real validation copy for a half-entered custom
            range, instead of the generic error state or a silent blank
            page (the query stays disabled until both dates are set). */}
        {!isLoading && rangeIncomplete && <p style={s.rangeIncomplete}>{t("range.incomplete")}</p>}

        {!isLoading && !rangeIncomplete && !isError && wholeWorkspaceEmpty && (
          <EmptyState icon="BarChart" title={t("empty.title")} body={t("empty.body")} />
        )}

        {!isLoading && !rangeIncomplete && !isError && data && !wholeWorkspaceEmpty && grouped && pooled && (
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
                </table>
              </div>

              {grouped.allLowConfidence && grouped.lowConfidence.length > 0 && (
                <p style={s.muted}>{t("notRankable")}</p>
              )}

              {grouped.lowConfidence.length > 0 && (
                <>
                  <div style={s.groupLabel}>{t("lowConfidenceGroup")}</div>
                  {/* C1 fix-loop — repeat the SAME <thead> as the ranked
                      table above (not a second, structurally different
                      table) so row heights/column alignment read as one
                      coherent table with a group separator, not two. */}
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
                    </table>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
