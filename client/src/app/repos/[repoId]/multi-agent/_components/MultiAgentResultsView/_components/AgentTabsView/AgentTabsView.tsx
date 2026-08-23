/* AgentTabsView — one tab per participating agent, showing only that agent's
   own findings (WI13). Columns and Tabs are two LAYOUTS sharing one trace
   mechanism: the active tab's "View trace" affordance calls the SAME
   `onOpenTrace(runId)` the results view wires to its single shared
   `openRunId` state — this component holds no drawer state of its own. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, CircularScore, Icon } from "@devdigest/ui";
import type { AgentColumn, ReviewRecord, Verdict } from "@devdigest/shared";
import { formatCost } from "@/helpers/format";
import { VERDICT_META } from "@/app/repos/[repoId]/pulls/[number]/_components/VerdictBanner/constants";
import { agentVisualFrom, agentVisuals } from "../../../../agent-visuals";
import { TabFindingRow } from "./_components/TabFindingRow";
import { s } from "./styles";

function verdictMetaFor(verdict: string | null) {
  return verdict != null && verdict in VERDICT_META ? VERDICT_META[verdict as Verdict] : null;
}

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
  const tPr = useTranslations("prReview");
  const [activeRunId, setActiveRunId] = React.useState<string | null>(columns[0]?.run_id ?? null);
  const active = columns.find((c) => c.run_id === activeRunId) ?? columns[0] ?? null;
  const findings = active ? reviews.find((r) => r.run_id === active.run_id)?.findings ?? [] : [];
  const visuals = React.useMemo(
    () => agentVisuals(columns.map((c) => ({ id: c.agent_id, name: c.agent_name }))),
    [columns],
  );

  if (!active) return null;

  const activeVisual = agentVisualFrom(visuals, active.agent_id);
  const verdictMeta = verdictMetaFor(active.verdict);
  const durationS = active.duration_ms != null ? Math.round(active.duration_ms / 1000) : null;

  return (
    <div style={s.root}>
      <div style={s.tabBar} role="tablist">
        {columns.map((c) => {
          const visual = agentVisualFrom(visuals, c.agent_id);
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
              {c.score != null &&
                (isActive ? (
                  <span style={s.tabScore(visual.color)}>{c.score}</span>
                ) : (
                  <span style={s.tabScoreMuted}>{c.score}</span>
                ))}
            </button>
          );
        })}
      </div>
      <div style={s.summaryCard(activeVisual.color)}>
        {active.score != null && <CircularScore score={active.score} size={44} stroke={4} />}
        <div style={s.summaryMain}>
          <div style={s.summaryTopRow}>
            <span style={s.summaryName}>{active.agent_name}</span>
            <Button kind="ghost" size="sm" icon="PanelRight" onClick={() => onOpenTrace(active.run_id)}>
              {t("viewTrace")}
            </Button>
          </div>
          {active.summary && <p style={s.summaryText}>{active.summary}</p>}
          <div style={s.summaryMetaRow}>
            {verdictMeta ? (
              <span style={s.verdictLabel(verdictMeta.c)}>{tPr(`verdict.${verdictMeta.labelKey}`)}</span>
            ) : (
              <span />
            )}
            <span style={s.summaryStats}>
              {durationS != null && `${durationS}s`}
              {durationS != null && active.cost_usd != null && " · "}
              {active.cost_usd != null && formatCost(active.cost_usd)}
            </span>
          </div>
        </div>
      </div>
      {findings.length === 0 ? (
        <div style={s.empty}>{t("column.noFindings")}</div>
      ) : (
        findings.map((f) => <TabFindingRow key={f.id} finding={f} prId={prId} />)
      )}
    </div>
  );
}
