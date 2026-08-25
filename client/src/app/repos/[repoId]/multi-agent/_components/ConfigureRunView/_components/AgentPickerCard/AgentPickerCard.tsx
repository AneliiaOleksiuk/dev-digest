/* AgentPickerCard — one checkbox row in the "2 Agents to run" step (WI11).
   Lists an agent regardless of its `enabled` flag (the picker shows EVERY
   workspace agent, no allow-list), and renders its historical estimate —
   or an explicit "no estimate yet" state — never a fabricated number. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Checkbox, Icon } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import type { AgentCostEstimate } from "@/lib/hooks/multi-agent";
import { formatCost } from "@/helpers/format";
import { agentEstimateFor } from "../../helpers";
import type { AgentVisual } from "../../../../agent-visuals";
import { s } from "./styles";

export function AgentPickerCard({
  agent,
  stats,
  visual,
  checked,
  onToggle,
}: {
  agent: Agent;
  stats: AgentCostEstimate | undefined;
  visual: AgentVisual;
  checked: boolean;
  onToggle: (checked: boolean) => void;
}) {
  const t = useTranslations("runs");
  const estimate = agentEstimateFor(stats);
  const VisualIcon = Icon[visual.icon];

  return (
    <div style={s.card(checked, visual.color)}>
      <Checkbox checked={checked} onChange={onToggle} />
      <div style={s.main}>
        <div style={s.nameRow}>
          <VisualIcon size={14} style={{ color: visual.color }} />
          {agent.name}
        </div>
        <div style={s.metaRow}>
          <span>{agent.description || agent.model}</span>
          {!agent.enabled && <span>· {t("page.agentCard.disabled")}</span>}
        </div>
      </div>
      {estimate ? (
        <div style={s.estimate}>
          <div>
            {t("page.agentCard.estimate", {
              duration: estimate.durationS.toFixed(1),
              cost: formatCost(estimate.costUsd),
            })}
          </div>
          <div style={s.sampleNote}>
            {t("page.agentCard.fromRuns", { count: estimate.sampleRuns })}
          </div>
        </div>
      ) : (
        <div style={s.estimateMuted}>{t("page.agentCard.noEstimate")}</div>
      )}
    </div>
  );
}
