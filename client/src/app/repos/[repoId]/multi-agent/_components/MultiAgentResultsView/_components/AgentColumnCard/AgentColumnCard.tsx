/* AgentColumnCard — one column per participating agent (WI12). A thin wrapper
   around `useRunEvents` (called with ONLY this column's own run id, never the
   batch's whole runId list) + the untouched `LiveLogStream` — each column
   settles to its own terminal state independently while siblings may still
   be running. Status is never color-only (icon + text label). A failed OR
   cancelled column shows its OWN persisted `error` field inline — never a
   global toast (see `../../../../../../../../lib/hooks/reviews.ts`'s SSE
   `error`-event toast, which would otherwise fire once per failing agent).
   `summary` is never read for this purpose — the server only ever populates
   it with a genuine review summary, not a failure/cancellation reason. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, CircularScore, Icon, LiveLogStream, SeverityBadge, type LogLine } from "@devdigest/ui";
import type { AgentColumn } from "@devdigest/shared";
import { formatCost } from "@/helpers/format";
import { useRunEvents } from "@/lib/hooks/reviews";
import { agentVisual } from "../../../../agent-visuals";
import { statusMetaFor } from "./helpers";
import { s } from "./styles";

const LOG_HEIGHT = 160;
// Top findings shown inline per the Columns design screenshot — the rest are
// still counted in the footer and fully visible in Tabs/the finding groups
// below; this cap keeps a done column's height sane with a noisy agent.
const INLINE_FINDINGS_LIMIT = 3;

export function AgentColumnCard({
  column,
  onOpenTrace,
}: {
  column: AgentColumn;
  onOpenTrace: () => void;
}) {
  const t = useTranslations("runs");
  const meta = statusMetaFor(column.status);
  const StatusIcon = Icon[meta.icon];
  const visual = agentVisual(column.agent_name);
  const VisualIcon = Icon[visual.icon];

  // Stream ONLY while this column is actually running — a settled column's
  // state is already fully described by the persisted `column` fields, and
  // subscribing every finished column's SSE endpoint would be both wasteful
  // and (per WI12) exactly the kind of per-column duplication this component
  // is meant to avoid.
  const streamIds = column.status === "running" ? [column.run_id] : [];
  const { events } = useRunEvents(streamIds);
  const log: LogLine[] = events.map((e) => ({ t: e.t, k: e.kind as LogLine["k"], m: e.msg }));

  const durationS = column.duration_ms != null ? Math.round(column.duration_ms / 1000) : null;

  return (
    <div style={s.card(visual.color)}>
      <div style={s.head}>
        <VisualIcon size={14} style={{ color: visual.color }} />
        <span style={s.agentName}>{column.agent_name}</span>
        <span style={s.statusChip(meta.color)}>
          <StatusIcon size={13} />
          {t(meta.labelKey)}
        </span>
      </div>

      {column.status === "running" ? (
        <LiveLogStream log={log} running height={LOG_HEIGHT} />
      ) : column.status === "failed" || column.status === "cancelled" ? (
        <div style={s.errorBox} role="alert">
          <Icon.AlertOctagon size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{column.error ?? t(`page.columnCard.status.${column.status}`)}</span>
        </div>
      ) : (
        <>
          <div style={s.meta}>
            {column.score != null && <CircularScore score={column.score} size={36} stroke={3} />}
            {durationS != null && <span>{durationS}s</span>}
            <span>{formatCost(column.cost_usd)}</span>
          </div>
          {column.findings.length > 0 && (
            <div style={s.findingsList}>
              {column.findings.slice(0, INLINE_FINDINGS_LIMIT).map((f) => (
                <div key={f.id} style={s.findingRow}>
                  <SeverityBadge severity={f.severity} compact />
                  <div style={s.findingMain}>
                    <div style={s.findingTitle}>{f.title}</div>
                    <div className="mono" style={s.findingLoc}>
                      {f.file}:{f.start_line}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div style={s.footer}>
        <Button kind="ghost" size="sm" icon="PanelRight" onClick={onOpenTrace}>
          {t("viewTrace")}
        </Button>
        {column.status === "done" && (
          <span style={s.footerCount}>{t("column.findingsCount", { count: column.findings.length })}</span>
        )}
      </div>
    </div>
  );
}
