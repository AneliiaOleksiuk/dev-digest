/* AgentTabsView — one tab per participating agent, showing only that agent's
   own findings (WI13). Columns and Tabs are two LAYOUTS sharing one trace
   mechanism: the active tab's "View trace" affordance calls the SAME
   `onOpenTrace(runId)` the results view wires to its single shared
   `openRunId` state — this component holds no drawer state of its own. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon } from "@devdigest/ui";
import type { AgentColumn, ReviewRecord } from "@devdigest/shared";
import { agentVisual } from "../../../../agent-visuals";
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
      <div style={s.tabBar} role="tablist">
        {columns.map((c) => {
          const visual = agentVisual(c.agent_name);
          const TabIcon = Icon[visual.icon];
          const isActive = c.run_id === active.run_id;
          return (
            <button
              key={c.run_id}
              type="button"
              role="tab"
              aria-selected={isActive}
              style={s.tabBtn(isActive, visual.color)}
              onClick={() => setActiveRunId(c.run_id)}
            >
              <TabIcon size={14} style={{ color: isActive ? visual.color : "var(--text-muted)" }} />
              {c.agent_name}
              {c.score != null && <span style={s.tabScore(visual.color)}>{c.score}</span>}
            </button>
          );
        })}
      </div>
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
