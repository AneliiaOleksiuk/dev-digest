"use client";

import React from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Button, ErrorState, Icon, LineChart, MetricCard, Skeleton } from "@devdigest/ui";
import { useAgent } from "@/lib/hooks/agents";
import { useAgentEvalBatches, useAgentEvalDashboard, useRunEvalSet } from "@/lib/hooks/eval";
import { formatCost } from "@/helpers/format";
import { notify } from "@/lib/toast";
import { AppShell } from "@/components/app-shell";
import { EvalCompareView } from "../EvalCompareView";
import { trendSeries } from "./helpers";
import { s } from "./styles";

/**
 * Per-agent eval detail (AC-37, AC-38, AC-39) — current metrics + trend +
 * recent-runs (batches) table, plus a two-row picker into the read-only
 * compare view (`EvalCompareView`). `?agent=<id>&base=<id>&head=<id>`
 * drills into the compare view; clearing `base`/`head` comes back here.
 */
export function AgentEvalDetail({ agentId, onBack }: { agentId: string; onBack: () => void }) {
  const t = useTranslations("eval");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const { data: agent } = useAgent(agentId);
  const { data: dashboard, isLoading, isError, refetch } = useAgentEvalDashboard(agentId);
  const { data: batches } = useAgentEvalBatches(agentId);
  const runSet = useRunEvalSet();
  const [selected, setSelected] = React.useState<string[]>([]);

  const baseId = searchParams.get("base");
  const headId = searchParams.get("head");

  const goToCompare = (base: string, head: string) => {
    const params = new URLSearchParams(searchParams);
    params.set("agent", agentId);
    params.set("base", base);
    params.set("head", head);
    router.push(`${pathname}?${params.toString()}`);
  };
  const clearCompare = () => {
    const params = new URLSearchParams(searchParams);
    params.delete("base");
    params.delete("head");
    router.push(`${pathname}?${params.toString()}`);
  };

  if (baseId && headId) {
    return (
      <EvalCompareView agentId={agentId} baseId={baseId} headId={headId} agentName={agent?.name} onClose={clearCompare} />
    );
  }

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1]!, id];
      return [...prev, id];
    });
  };

  const compareSelected = () => {
    if (selected.length !== 2) return;
    const rows = (batches ?? []).filter((b) => selected.includes(b.id));
    const [a, b] = rows.sort((x, y) => new Date(x.ran_at).getTime() - new Date(y.ran_at).getTime());
    if (a && b) goToCompare(a.id, b.id);
  };

  const crumb = [
    { label: t("page.crumbSkillsLab") },
    { label: t("page.crumbEvalDashboard"), href: "/evals" },
    { label: agent?.name ?? t("page.crumbAgents") },
  ];

  if (isLoading || !dashboard) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.page}>
          <Skeleton height={32} width={240} />
          <Skeleton height={120} />
          <Skeleton height={220} />
        </div>
      </AppShell>
    );
  }
  if (isError) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState fullScreen body="Couldn't load eval data." onRetry={() => refetch()} />
      </AppShell>
    );
  }

  const isFirstRun = dashboard.delta === null && dashboard.trend.length <= 1;
  // `current.*` is sourced from `recent_runs[0]` (see the server's
  // `buildDashboard`) — so that SAME batch's own `*_cases`/`cases_total` are
  // the honest contributing-case count for the metric shown here (AC-30,
  // UX-5). Deliberately NOT `dashboard.cases_total` (the owner's whole
  // case set) — a mean over 2 of this batch's 8 cases must not be read as a
  // mean over the owner's full N.
  const latestBatch = dashboard.recent_runs[0];
  const metrics = [
    {
      key: "recall",
      label: t("dashboard.metrics.recall"),
      value: dashboard.current.recall,
      delta: dashboard.delta?.recall,
      color: "var(--accent)",
      cases: latestBatch?.recall_cases,
    },
    {
      key: "precision",
      label: t("dashboard.metrics.precision"),
      value: dashboard.current.precision,
      delta: dashboard.delta?.precision,
      color: "var(--ok)",
      cases: latestBatch?.precision_cases,
    },
    {
      key: "citation",
      label: t("dashboard.metrics.citationAccuracy"),
      value: dashboard.current.citation_accuracy,
      delta: dashboard.delta?.citation_accuracy,
      color: "var(--warn)",
      cases: latestBatch?.citation_cases,
    },
  ] as const;

  const series = [
    { name: t("dashboard.legend.recall"), color: "var(--accent)", data: trendSeries(dashboard, "recall") },
    { name: t("dashboard.legend.precision"), color: "var(--ok)", data: trendSeries(dashboard, "precision") },
    { name: t("dashboard.legend.citation"), color: "var(--warn)", data: trendSeries(dashboard, "citation_accuracy") },
  ].filter((sr) => sr.data.length > 0);

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <div style={s.header}>
          <Button kind="ghost" size="sm" icon="ChevronLeft" onClick={onBack}>
            {t("page.crumbEvalDashboard")}
          </Button>
          <h1 style={s.h1}>{agent?.name ?? t("page.crumbAgents")}</h1>
          <Button
            kind="primary"
            size="sm"
            icon="Play"
            loading={runSet.isPending}
            disabled={dashboard.cases_total === 0}
            onClick={() =>
              runSet.mutate(agentId, {
                onError: (err) => notify.error(err instanceof Error ? err.message : "Run failed"),
              })
            }
          >
            {runSet.isPending
              ? t("dashboard.running")
              : t("dashboard.runEval", { count: dashboard.cases_total })}
          </Button>
        </div>

        {dashboard.cases_total > 0 && (
          <span style={s.naNote}>
            {t("dashboard.runEstimate", { calls: dashboard.cases_total, cost: formatCost(dashboard.current.cost_usd) })}
          </span>
        )}

        <div style={s.metricsRow}>
          {metrics.map((m) => (
            <div key={m.key} style={s.metricWrap}>
              <MetricCard
                label={m.label}
                value={m.value != null ? `${Math.round(m.value * 100)}%` : t("dashboard.na")}
                color={m.color}
                delta={!isFirstRun ? (m.delta ?? undefined) : undefined}
              />
              {m.value == null && dashboard.cases_total > 0 && <p style={s.naNote}>{t("dashboard.naReason")}</p>}
              {latestBatch && (
                <p style={s.naNote}>
                  {t("dashboard.metricCasesCaption", { count: m.cases, total: latestBatch.cases_total })}
                </p>
              )}
            </div>
          ))}
        </div>
        {isFirstRun && dashboard.cases_total > 0 && <p style={s.naNote}>{t("compare.firstRunNothing")}</p>}
        <p style={s.note}>{t("dashboard.relativeScoresNote")}</p>

        <div>
          <h2 style={s.sectionTitle}>{t("dashboard.metricTrend")}</h2>
          {series.length === 0 ? (
            <p style={s.naNote}>{t("dashboard.noRuns")}</p>
          ) : (
            <>
              {/* AC-39/E-7/UX-6 — explicit [0, 1] domain; LineChart's own
                 defaults (yMin=0.6) would clip a deliberately-weakened
                 prompt's precision drop right off the chart. */}
              <LineChart series={series} yMin={0} yMax={1} />
              <p style={s.chartCaption}>
                Each line plots only that metric's own measured points — a run where a metric was
                undefined (E-11) is omitted, not shown as zero, so the two lines may not share the
                same x position.
              </p>
            </>
          )}
        </div>

        <div>
          <h2 style={s.sectionTitle}>{t("dashboard.recentRuns")}</h2>
          {(batches ?? []).length === 0 ? (
            <p style={s.naNote}>{t("dashboard.noRuns")}</p>
          ) : (
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th} />
                  <th style={s.th}>{t("dashboard.table.ranAt")}</th>
                  <th style={s.th}>v</th>
                  <th style={s.th}>{t("dashboard.table.recall")}</th>
                  <th style={s.th}>{t("dashboard.table.precision")}</th>
                  <th style={s.th}>{t("dashboard.table.citation")}</th>
                  <th style={s.th}>{t("dashboard.table.pass")}</th>
                  <th style={s.th}>{t("dashboard.table.cost")}</th>
                </tr>
              </thead>
              <tbody>
                {(batches ?? []).map((b) => (
                  <tr
                    key={b.id}
                    style={{ ...s.rowSelectable, ...(selected.includes(b.id) ? s.rowSelected : {}) }}
                    onClick={() => toggleSelect(b.id)}
                  >
                    <td style={s.td}>
                      <input type="checkbox" checked={selected.includes(b.id)} readOnly />
                    </td>
                    <td style={s.td}>{new Date(b.ran_at).toLocaleString()}</td>
                    <td style={s.td}>
                      {/* UX-7/Q-3 — recorded agent_version plus the skills-
                         fingerprint caveat, as a plain tooltip (not an
                         AC-41-enumerated new i18n key). */}
                      <Badge
                        mono
                        color="var(--text-secondary)"
                        style={{ cursor: "help" }}
                      >
                        <span title="Skills may have changed without bumping this version — compare skills_fingerprint to be sure">
                          v{b.agent_version}
                        </span>
                      </Badge>
                    </td>
                    <td style={s.td}>{b.recall != null ? `${Math.round(b.recall * 100)}%` : t("dashboard.na")}</td>
                    <td style={s.td}>{b.precision != null ? `${Math.round(b.precision * 100)}%` : t("dashboard.na")}</td>
                    <td style={s.td}>
                      {b.citation_accuracy != null ? `${Math.round(b.citation_accuracy * 100)}%` : t("dashboard.na")}
                    </td>
                    <td style={s.td}>
                      <span style={{ color: b.status === "failed" ? "var(--crit)" : "var(--text-primary)" }}>
                        {b.cases_passed}/{b.cases_total}
                      </span>
                    </td>
                    <td style={s.td}>{formatCost(b.cost_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={s.compareBar}>
            <Icon.Layers size={14} style={{ color: "var(--text-muted)" }} />
            {(batches ?? []).length < 2 ? (
              <span style={s.naNote}>{t("compare.firstRunNothing")}</span>
            ) : (
              <>
                <span style={s.naNote}>Select two runs above to compare.</span>
                <Button kind="secondary" size="sm" disabled={selected.length !== 2} onClick={compareSelected}>
                  Compare
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
