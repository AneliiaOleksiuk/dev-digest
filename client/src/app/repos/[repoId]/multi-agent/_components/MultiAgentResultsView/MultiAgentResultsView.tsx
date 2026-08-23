/* MultiAgentResultsView — the batch results shell (WI12+WI13). Columns and
   Tabs are two LAYOUTS over the same batch; Grouped findings and the
   disagreement block are two DERIVED views shown below either layout. The
   WHOLE page holds exactly ONE `openRunId` state and mounts exactly ONE
   `<RunTraceDrawer>` — every "View trace" affordance, in every layout, sets
   the same state. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { formatCost } from "@/helpers/format";
import { usePulls } from "@/lib/hooks/core";
import { useMultiAgentRun } from "@/lib/hooks/multi-agent";
import { usePrReviews } from "@/lib/hooks/reviews";
import { RunTraceDrawer } from "@/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer";
import { AgentColumnCard } from "./_components/AgentColumnCard";
import { AgentTabsView } from "./_components/AgentTabsView";
import { FindingGroupsSection } from "./_components/FindingGroupsSection";
import { DisagreementSection } from "./_components/DisagreementSection";
import { columnsProgress } from "./helpers";
import { s } from "./styles";

type ViewMode = "columns" | "tabs";

export function MultiAgentResultsView({
  runId,
  repoId,
  onBack,
}: {
  runId: string;
  repoId: string;
  onBack: () => void;
}) {
  const t = useTranslations("runs");
  const { data: run, isLoading, isError, refetch } = useMultiAgentRun(runId);
  const { data: reviews } = usePrReviews(run?.pr_id ?? null);
  const { data: pulls } = usePulls(repoId);
  const pr = run ? (pulls ?? []).find((p) => p.id === run.pr_id) : null;
  const [viewMode, setViewMode] = React.useState<ViewMode>("columns");
  const [openRunId, setOpenRunId] = React.useState<string | null>(null);

  const allFindings: FindingRecord[] = React.useMemo(() => (reviews ?? []).flatMap((r) => r.findings), [reviews]);
  const findingsById = React.useMemo(() => new Map(allFindings.map((f) => [f.id, f])), [allFindings]);

  if (isLoading) {
    return (
      <div style={s.root}>
        <Skeleton height={20} width={200} />
        <Skeleton height={220} />
      </div>
    );
  }

  if (isError || !run) {
    return <ErrorState body="Couldn't load this multi-agent run." onRetry={() => refetch()} />;
  }

  const progress = columnsProgress(run.columns);
  const openColumn = run.columns.find((c) => c.run_id === openRunId) ?? null;
  const openColumnFindings = openColumn
    ? (reviews ?? []).find((r) => r.run_id === openColumn.run_id)?.findings ?? []
    : [];

  return (
    <div style={s.root}>
      {/* ONE shared progress announcement, not one per column (six
          simultaneous "polite" live regions would be as unhelpful as none). */}
      <div aria-live="polite" style={s.srOnly}>
        {t("page.liveRegion", { done: progress.done, total: progress.total })}
      </div>

      <div style={s.headerRow}>
        <div style={s.headerLeft}>
          <Button kind="ghost" size="sm" icon="Settings" onClick={onBack}>
            {t("page.back")}
          </Button>
          <span style={s.titleLine}>
            {t("page.title")}
            <span style={s.titleMeta}>
              {t("page.selectedAgents", { count: run.agent_count })}
            </span>
          </span>
        </div>
        <div style={s.viewToggle} role="tablist">
          {(["columns", "tabs"] as const).map((mode) => {
            const ModeIcon = Icon[mode === "columns" ? "Layers" : "PanelRight"];
            return (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={viewMode === mode}
                style={s.viewToggleBtn(viewMode === mode)}
                onClick={() => setViewMode(mode)}
              >
                <ModeIcon size={13} />
                {t(`page.view.${mode}`)}
              </button>
            );
          })}
        </div>
      </div>

      <div style={s.prRow}>
        <div style={s.prTitle}>
          {pr && (
            <>
              <span className="mono">#{pr.number}</span> {pr.title}
            </>
          )}
        </div>
        <div style={s.metaLine}>
          <span>
            {t("page.meta", {
              count: run.agent_count,
              duration: Math.round(run.total_duration_ms / 1000),
              cost: formatCost(run.total_cost_usd),
            })}
          </span>
          {run.total_cost_partial && (
            <Badge color="var(--warn)" icon="AlertTriangle">
              {t("page.metaPartial")}
            </Badge>
          )}
        </div>
      </div>

      {viewMode === "columns" ? (
        <div style={s.columnsGrid}>
          {run.columns.map((col) => (
            <AgentColumnCard key={col.run_id} column={col} onOpenTrace={() => setOpenRunId(col.run_id)} />
          ))}
        </div>
      ) : (
        <AgentTabsView
          columns={run.columns}
          reviews={reviews ?? []}
          prId={run.pr_id}
          onOpenTrace={(id) => setOpenRunId(id)}
        />
      )}

      <FindingGroupsSection groups={run.groups} findingsById={findingsById} prId={run.pr_id} />
      <DisagreementSection conflicts={run.conflicts} />

      {openColumn && (
        <RunTraceDrawer
          runId={openColumn.run_id}
          agentName={openColumn.agent_name}
          prNumber={run.pr_number ?? null}
          findings={openColumnFindings}
          running={openColumn.status === "running"}
          onClose={() => setOpenRunId(null)}
        />
      )}
    </div>
  );
}
