"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, ErrorState, SelectInput, Skeleton } from "@devdigest/ui";
import { useCiRuns } from "@/lib/hooks/ci";
import { formatCost } from "@/helpers/format";
import { AppShell } from "@/components/app-shell";
import {
  agentLabel,
  applyFilters,
  distinctAgentOptions,
  distinctRepoOptions,
  distinctSourceOptions,
  EMPTY_FILTERS,
  findingsDisplay,
  formatDuration,
  formatTimestamp,
  sourceLabel,
  statusI18nKey,
  statusVisual,
  type CiRunsFilterState,
} from "./helpers";
import { s } from "./styles";

const SINCE_DAYS_OPTIONS = [
  { value: "1", label: "Last 24 hours" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

/**
 * CI Runs page (WI22, AC-61..AC-69) — agent reviews executed inside CI, read
 * from `GET /ci/runs`. One fetch, scoped only by the time-window filter
 * (server-side); the other four filters (agent/repo/status/source) narrow
 * that same result set client-side (see helpers.ts's file header) — manual
 * Refresh only, no polling (UX-20).
 */
export function CiRunsView() {
  const t = useTranslations("ci");
  const [sinceDays, setSinceDays] = React.useState(7);
  const [filters, setFilters] = React.useState<CiRunsFilterState>(EMPTY_FILTERS);

  const { data: runs, isLoading, isError, isFetching, refetch } = useCiRuns({ since_days: sinceDays });

  const agentOptions = React.useMemo(() => distinctAgentOptions(runs ?? []), [runs]);
  const repoOptions = React.useMemo(() => distinctRepoOptions(runs ?? []), [runs]);
  const sourceOptions = React.useMemo(() => distinctSourceOptions(runs ?? []), [runs]);
  const shown = React.useMemo(() => applyFilters(runs ?? [], filters), [runs, filters]);

  const setFilter = (patch: Partial<CiRunsFilterState>) => setFilters((prev) => ({ ...prev, ...patch }));

  return (
    <AppShell crumb={[{ label: t("page.crumb") }]}>
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>{t("runs.title")}</h1>
            <p style={s.subtitle}>{t("runs.subtitle")}</p>
          </div>
          <Button kind="secondary" size="sm" icon="RefreshCw" loading={isFetching} onClick={() => refetch()}>
            {isFetching ? t("runs.refreshing") : t("runs.refresh")}
          </Button>
        </div>

        <div style={s.filters}>
          <div style={s.filterWrap}>
            <SelectInput
              value={String(sinceDays)}
              onChange={(v) => setSinceDays(Number(v))}
              options={SINCE_DAYS_OPTIONS}
            />
          </div>
          <div style={s.filterWrap}>
            <SelectInput
              value={filters.agentId}
              onChange={(v) => setFilter({ agentId: v })}
              options={[{ value: "", label: t("runs.filters.allAgents") }, ...agentOptions]}
            />
          </div>
          <div style={s.filterWrap}>
            <SelectInput
              value={filters.repo}
              onChange={(v) => setFilter({ repo: v })}
              options={[{ value: "", label: t("runs.filters.allRepos") }, ...repoOptions]}
            />
          </div>
          <div style={s.filterWrap}>
            <SelectInput
              value={filters.status}
              onChange={(v) => setFilter({ status: v })}
              options={[
                { value: "", label: t("runs.filters.allStatuses") },
                { value: "succeeded", label: t("runs.status.succeeded") },
                { value: "no_findings", label: t("runs.status.noFindings") },
                { value: "failed", label: t("runs.status.failed") },
                { value: "running", label: t("runs.status.running") },
              ]}
            />
          </div>
          <div style={s.filterWrap}>
            <SelectInput
              value={filters.source}
              onChange={(v) => setFilter({ source: v })}
              options={[{ value: "", label: t("runs.filters.allSources") }, ...sourceOptions]}
            />
          </div>
        </div>

        {isLoading && (
          <>
            <Skeleton height={40} />
            <Skeleton height={200} />
          </>
        )}
        {isError && <ErrorState body="Couldn't load CI runs." onRetry={() => refetch()} />}
        {!isLoading && !isError && shown.length === 0 && (
          <EmptyState icon="GitBranch" title={t("runs.emptyTitle")} body={t("runs.emptyBody")} />
        )}

        {!isLoading && !isError && shown.length > 0 && (
          <div style={s.tableWrap}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>{t("runs.table.timestamp")}</th>
                  <th style={s.th}>{t("runs.table.pullRequest")}</th>
                  <th style={s.th}>{t("runs.table.agent")}</th>
                  <th style={s.th}>{t("runs.table.source")}</th>
                  <th style={s.th}>{t("runs.table.duration")}</th>
                  <th style={s.th}>{t("runs.table.findings")}</th>
                  <th style={s.th}>{t("runs.table.cost")}</th>
                  <th style={s.th}>{t("runs.table.status")}</th>
                  <th style={s.th} />
                </tr>
              </thead>
              <tbody>
                {shown.map((run) => {
                  const findings = findingsDisplay(run);
                  const visual = statusVisual(run.status);
                  const key = statusI18nKey(run.status);
                  return (
                    <tr key={run.id}>
                      <td style={s.td}>{formatTimestamp(run.ran_at)}</td>
                      <td style={s.td}>
                        <div style={s.prCell}>
                          <span style={s.prNumber}>{run.pr_number != null ? `#${run.pr_number}` : "—"}</span>
                          {run.pr_title && <span style={s.prTitle}>{run.pr_title}</span>}
                        </div>
                      </td>
                      <td style={s.td}>{agentLabel(run)}</td>
                      <td style={s.td}>{sourceLabel(run)}</td>
                      <td style={s.td}>{formatDuration(run.duration_s)}</td>
                      <td style={s.td}>
                        <div style={s.findingsCell}>
                          {findings.mode === "split" && (
                            <>
                              {findings.critical != null && (
                                <span style={{ ...s.severityChip, color: "var(--crit)" }}>
                                  {t("runs.severity.critical").charAt(0)} {findings.critical}
                                </span>
                              )}
                              {findings.warning != null && (
                                <span style={{ ...s.severityChip, color: "var(--warn)" }}>
                                  {t("runs.severity.warning").charAt(0)} {findings.warning}
                                </span>
                              )}
                              {findings.suggestion != null && (
                                <span style={{ ...s.severityChip, color: "var(--text-muted)" }}>
                                  {t("runs.severity.suggestion").charAt(0)} {findings.suggestion}
                                </span>
                              )}
                            </>
                          )}
                          {findings.mode === "total" && <span>{findings.total}</span>}
                          {findings.mode === "unknown" && <span style={s.muted}>—</span>}
                        </div>
                      </td>
                      <td style={s.td}>{formatCost(run.cost_usd)}</td>
                      <td style={s.td}>
                        <Badge color={visual.color} bg={visual.bg} icon={visual.icon}>
                          {key ? t(`runs.status.${key}`) : (run.status ?? "—")}
                        </Badge>
                      </td>
                      <td style={s.td}>
                        <div style={s.linkCell}>
                          {run.github_url ? (
                            <a href={run.github_url} target="_blank" rel="noopener noreferrer">
                              <Button kind="ghost" size="sm" icon="ExternalLink">
                                {t("runs.view")}
                              </Button>
                            </a>
                          ) : (
                            <span style={s.muted}>—</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
