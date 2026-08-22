/* ConfigureRunView — "1 Pull request" / "2 Agents to run" (WI11). Renders
   every workspace agent (no allow-list) with its historical estimate, rolls
   the current selection up into ONE estimate via the pure helper in
   `./helpers`, and starts the batch via `useStartMultiAgentRun`. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, SearchableSelect, Skeleton } from "@devdigest/ui";
import { formatCost } from "@/helpers/format";
import { usePulls } from "@/lib/hooks/core";
import { useAgents } from "@/lib/hooks/agents";
import { useAgentStats, useStartMultiAgentRun } from "@/lib/hooks/multi-agent";
import { AgentPickerCard } from "./_components/AgentPickerCard";
import { computeSelectionEstimate, defaultSelectedAgentIds } from "./helpers";
import { s } from "./styles";

export function ConfigureRunView({
  repoId,
  initialPrId = null,
  onRunStarted,
}: {
  repoId: string;
  initialPrId?: string | null;
  onRunStarted: (runId: string) => void;
}) {
  const t = useTranslations("runs");
  const router = useRouter();

  const { data: pulls, isLoading: pullsLoading } = usePulls(repoId);
  const { data: agents, isLoading: agentsLoading } = useAgents();
  const { data: stats } = useAgentStats();
  const start = useStartMultiAgentRun();

  const [prId, setPrId] = React.useState<string | null>(initialPrId);
  const [selectedIds, setSelectedIds] = React.useState<string[] | null>(null);

  // Seed the default selection (every enabled agent) exactly once, the first
  // time the agent list loads — later toggles are the user's own choice and
  // must not be clobbered by a refetch.
  React.useEffect(() => {
    if (selectedIds === null && agents) setSelectedIds(defaultSelectedAgentIds(agents));
  }, [agents, selectedIds]);

  const selected = selectedIds ?? [];
  const statsById = new Map((stats ?? []).map((st) => [st.agent_id, st]));
  const estimate = computeSelectionEstimate(stats ?? [], selected);
  const selectedPr = (pulls ?? []).find((p) => p.id === prId) ?? null;

  const toggleAgent = (agentId: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const cur = prev ?? [];
      return checked ? [...cur, agentId] : cur.filter((id) => id !== agentId);
    });
  };

  const handleRun = () => {
    if (!prId || selected.length === 0) return;
    start.mutate(
      { prId, agentIds: selected },
      { onSuccess: (data) => onRunStarted(data.id) },
    );
  };

  if (agentsLoading) {
    return (
      <div style={s.root}>
        <Skeleton height={20} width={160} />
        <Skeleton height={64} />
        <Skeleton height={64} />
      </div>
    );
  }

  if (!agents || agents.length === 0) {
    return (
      <EmptyState
        icon="Cpu"
        title={t("page.noAgents.title")}
        body={t("page.noAgents.body")}
        cta={t("page.noAgents.cta")}
        onCta={() => router.push("/agents")}
      />
    );
  }

  return (
    <div style={s.root}>
      <div style={s.step}>
        <div style={s.stepHead}>
          <span style={s.stepBadge}>1</span>
          <div style={s.stepTitle}>{t("page.steps.pr")}</div>
        </div>
        {prId && selectedPr ? (
          <div style={s.selectedPrRow}>
            <span className="mono">#{selectedPr.number}</span>
            <span>{selectedPr.title}</span>
            <span style={{ flex: 1 }} />
            <Button kind="ghost" size="sm" onClick={() => setPrId(null)}>
              {t("page.selectPr")}
            </Button>
          </div>
        ) : pullsLoading ? (
          <Skeleton height={40} />
        ) : (
          <>
            <SearchableSelect
              value={prId ?? ""}
              onChange={setPrId}
              placeholder={t("page.selectPr")}
              options={(pulls ?? []).map((p) => ({
                value: p.id ?? "",
                label: t("page.prItem", { number: p.number, title: p.title }),
              }))}
              mono={false}
            />
            <div style={s.hint}>{t("page.noRun.bodySelect")}</div>
          </>
        )}
      </div>

      <div style={s.step}>
        <div style={{ ...s.stepHead, justifyContent: "space-between" }}>
          <div style={s.stepHead}>
            <span style={s.stepBadge}>2</span>
            <div style={s.stepTitle}>{t("page.steps.agents")}</div>
          </div>
          <Button kind="ghost" size="sm" onClick={() => setSelectedIds(agents.map((a) => a.id))}>
            {t("page.steps.selectAll")}
          </Button>
        </div>
        {agents.map((agent) => (
          <AgentPickerCard
            key={agent.id}
            agent={agent}
            stats={statsById.get(agent.id)}
            checked={selected.includes(agent.id)}
            onToggle={(checked) => toggleAgent(agent.id, checked)}
          />
        ))}
      </div>

      <div style={s.footer}>
        <div style={s.estimateBlock}>
          <span style={s.selectionCount}>{t("page.selection.count", { count: selected.length })}</span>
          {estimate.hasAnyEstimate ? (
            <span style={s.estimateLine}>
              {t("page.selection.estimate", {
                duration: Math.round((estimate.maxDurationMs ?? 0) / 1000),
                cost: formatCost(estimate.totalCostUsd),
              })}
              {estimate.costPartial && <span style={s.estimatePartial}> · {t("page.selection.estimatePartial")}</span>}
            </span>
          ) : (
            <span style={s.estimateLine}>{t("page.selection.noEstimate")}</span>
          )}
        </div>
        <Button
          kind="primary"
          icon="Play"
          disabled={!prId || selected.length === 0}
          loading={start.isPending}
          onClick={handleRun}
        >
          {t("page.selection.run", { count: selected.length })}
        </Button>
      </div>
    </div>
  );
}
