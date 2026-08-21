"use client";

import React from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton, Sparkline } from "@devdigest/ui";
import { useEvalDashboard, useRunEvalSet } from "@/lib/hooks/eval";
import { useAgents } from "@/lib/hooks/agents";
import { formatCost } from "@/helpers/format";
import { notify } from "@/lib/toast";
import { AppShell } from "@/components/app-shell";
import { AgentEvalDetail } from "../AgentEvalDetail";
import { ownerLabel, trendSparkline } from "./helpers";
import { s } from "./styles";

/**
 * Eval Dashboard page (AC-36/AC-37) — one entry per agent that has either a
 * case or a batch (E-15: an entry can outlive its owning agent). Selecting
 * a row (`?agent=<id>`) drills into `AgentEvalDetail`, which owns the
 * per-agent trend/history/compare view.
 */
export function EvalDashboardView() {
  const t = useTranslations("eval");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const { data: dashboards, isLoading, isError, refetch } = useEvalDashboard();
  const { data: agents } = useAgents();
  const runSet = useRunEvalSet();
  const [runningAll, setRunningAll] = React.useState(false);

  const agentId = searchParams.get("agent");

  const selectAgent = (id: string) => router.push(`${pathname}?agent=${id}`);
  const backToList = () => router.push(pathname);

  if (agentId) {
    return <AgentEvalDetail agentId={agentId} onBack={backToList} />;
  }

  const agentsById = new Map((agents ?? []).map((a) => [a.id, a]));
  const runnable = (dashboards ?? []).filter((d) => d.cases_total > 0 && d.owner_id);
  const totalCases = runnable.reduce((sum, d) => sum + d.cases_total, 0);
  const allCostsKnown = runnable.length > 0 && runnable.every((d) => d.current.cost_usd != null);
  const totalLastCost = allCostsKnown
    ? runnable.reduce((sum, d) => sum + (d.current.cost_usd ?? 0), 0)
    : null;

  const runAllAgents = async () => {
    setRunningAll(true);
    for (const d of runnable) {
      try {
        // AC-45 rate-limits each POST server-side; running sequentially
        // (not Promise.all) keeps this fan-out inside that same 10/min
        // budget instead of bursting it (A06).
        await runSet.mutateAsync(d.owner_id!);
      } catch (err) {
        notify.error(err instanceof Error ? err.message : `Run failed for agent ${d.owner_id}`);
      }
    }
    setRunningAll(false);
  };

  return (
    <AppShell crumb={[{ label: t("page.crumbSkillsLab") }, { label: t("page.crumbEvalDashboard") }]}>
      <div style={s.page}>
        <div style={s.header}>
          <h1 style={s.h1}>{t("dashboard.defaultTitle")}</h1>
          <div style={s.headerActions}>
            <Button
              kind="primary"
              size="sm"
              icon="Play"
              disabled={runnable.length === 0 || runningAll}
              onClick={runAllAgents}
            >
              {runningAll ? t("dashboard.running") : t("dashboard.runAllAgents", { count: runnable.length })}
            </Button>
            {runnable.length > 0 && (
              <span style={s.estimate}>
                {t("dashboard.runAllAgentsEstimate", {
                  calls: totalCases,
                  agents: runnable.length,
                  cost: formatCost(totalLastCost),
                })}
              </span>
            )}
            {/* E-10 — strategy: 'auto' can turn one case into several calls;
               not in AC-41's enumerated new-key list, so plain text. */}
            <span style={s.autoNote}>
              Estimate assumes one call per case — a case using strategy &quot;auto&quot; on a large diff
              can cost more.
            </span>
          </div>
        </div>

        <p style={s.rowMeta as React.CSSProperties}>{t("dashboard.relativeScoresNote")}</p>

        {isLoading && (
          <>
            <Skeleton height={72} />
            <Skeleton height={72} />
          </>
        )}
        {isError && <ErrorState body="Couldn't load the eval dashboard." onRetry={() => refetch()} />}
        {!isLoading && !isError && (dashboards ?? []).length === 0 && (
          <EmptyState icon="Gauge" title={t("dashboard.noRuns")} body={t("dashboard.configure")} />
        )}

        <div style={s.list}>
          {(dashboards ?? []).map((d) => (
            <Card key={d.owner_id ?? "unknown"} hover onClick={() => d.owner_id && selectAgent(d.owner_id)}>
              <div style={s.row}>
                <div style={s.rowMain}>
                  <span style={s.rowName}>{ownerLabel(d, agentsById)}</span>
                  <span style={s.rowMeta}>
                    {t("dashboard.casesSummary", { count: d.cases_total, runs: d.trend.length })}
                  </span>
                </div>
                <div style={s.rowMetrics}>
                  {(["recall", "precision", "citation_accuracy"] as const).map((metric) => {
                    const value = d.current[metric];
                    const label =
                      metric === "recall"
                        ? t("dashboard.metrics.recall")
                        : metric === "precision"
                          ? t("dashboard.metrics.precision")
                          : t("dashboard.metrics.citationAccuracy");
                    return (
                      <div key={metric} style={s.rowMetric}>
                        <span style={s.rowMetricLabel}>{label}</span>
                        <span style={s.rowMetricValue}>
                          {value != null ? `${Math.round(value * 100)}%` : t("dashboard.na")}
                        </span>
                      </div>
                    );
                  })}
                  <Sparkline data={trendSparkline(d, "recall")} w={64} h={22} />
                  {d.alert && <Badge color="var(--warn)">{d.alert}</Badge>}
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
