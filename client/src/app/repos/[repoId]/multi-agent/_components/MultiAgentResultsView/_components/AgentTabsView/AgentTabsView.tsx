/* AgentTabsView — one tab per participating agent, showing only that agent's
   own findings (WI13). Columns and Tabs are two LAYOUTS sharing one trace
   mechanism: the active tab's "View trace" affordance calls the SAME
   `onOpenTrace(runId)` the results view wires to its single shared
   `openRunId` state — this component holds no drawer state of its own. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Tabs } from "@devdigest/ui";
import type { AgentColumn, ReviewRecord } from "@devdigest/shared";
import { TabFindingRow } from "./_components/TabFindingRow";
import { s } from "./styles";

export function AgentTabsView({
  columns,
  reviews,
  prId,
  onOpenTrace,
}: {
  columns: AgentColumn[];
  reviews: ReviewRecord[];
  prId: string | null;
  onOpenTrace: (runId: string) => void;
}) {
  const t = useTranslations("runs");
  const [activeRunId, setActiveRunId] = React.useState<string | null>(columns[0]?.run_id ?? null);
  const active = columns.find((c) => c.run_id === activeRunId) ?? columns[0] ?? null;
  const findings = active ? reviews.find((r) => r.run_id === active.run_id)?.findings ?? [] : [];

  if (!active) return null;

  return (
    <div style={s.root}>
      <Tabs
        value={active.run_id}
        onChange={setActiveRunId}
        tabs={columns.map((c) => ({ key: c.run_id, label: c.agent_name, icon: "Cpu" as const }))}
      />
      <div style={s.header}>
        <div style={s.agentMeta}>
          <span className="mono">{active.model}</span>
          {active.score != null && <span>{t("page.columnCard.score")}: {active.score}</span>}
        </div>
        <Button kind="ghost" size="sm" icon="PanelRight" onClick={() => onOpenTrace(active.run_id)}>
          {t("viewTrace")}
        </Button>
      </div>
      {findings.length === 0 ? (
        <div style={s.empty}>{t("column.noFindings")}</div>
      ) : (
        findings.map((f) => <TabFindingRow key={f.id} finding={f} prId={prId} />)
      )}
    </div>
  );
}
