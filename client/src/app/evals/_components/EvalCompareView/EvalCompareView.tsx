"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, ErrorState, Skeleton } from "@devdigest/ui";
import { useEvalCompare } from "@/lib/hooks/eval";
import { formatCost } from "@/helpers/format";
import { AppShell } from "@/components/app-shell";
import { deltaColor, fmtDeltaPct, sameVersionDifferentSkills } from "./helpers";
import { s } from "./styles";

/**
 * Read-only compare view (AC-31/AC-32, D-8/Q-2 — no promote, no revert).
 * Both system prompts are the batch's own SNAPSHOT (`agent_versions.
 * config_json` at that version), never the agent's current prompt — a
 * missing snapshot renders `compare.promptUnavailable` instead of silently
 * substituting today's prompt (AC-32). Prompts render as plain text (a
 * `<pre>`, not markdown/`dangerouslySetInnerHTML`) — A05: a stored system
 * prompt is exactly the kind of content that must never reach a second
 * renderer.
 */
export function EvalCompareView({
  agentId,
  baseId,
  headId,
  agentName,
  onClose,
}: {
  agentId: string;
  baseId: string;
  headId: string;
  agentName?: string;
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const { data: comparison, isLoading, isError, refetch } = useEvalCompare(agentId, baseId, headId);

  const crumb = [
    { label: t("page.crumbSkillsLab") },
    { label: t("page.crumbEvalDashboard"), href: "/evals" },
    { label: agentName ?? t("page.crumbAgents") },
    { label: t("compare.title") },
  ];

  if (isLoading || !comparison) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.page}>
          <Skeleton height={32} width={240} />
          <Skeleton height={320} />
        </div>
      </AppShell>
    );
  }
  if (isError) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState fullScreen body="Couldn't load this comparison." onRetry={() => refetch()} />
      </AppShell>
    );
  }

  const { base, head, delta, base_prompt, head_prompt } = comparison;
  const columns = [
    { label: t("compare.base"), batch: base, prompt: base_prompt },
    { label: t("compare.head"), batch: head, prompt: head_prompt },
  ];

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <div style={s.header}>
          <Button kind="ghost" size="sm" icon="ChevronLeft" onClick={onClose}>
            {agentName ?? t("page.crumbAgents")}
          </Button>
          <h1 style={s.h1}>{t("compare.title")}</h1>
        </div>

        {sameVersionDifferentSkills(base, head) && (
          <p style={s.note}>{t("compare.sameVersionDifferentSkills")}</p>
        )}

        <div style={s.deltaBar}>
          {(
            [
              { label: t("dashboard.table.recall"), value: delta.recall, invert: false },
              { label: t("dashboard.table.precision"), value: delta.precision, invert: false },
              { label: t("dashboard.table.citation"), value: delta.citation_accuracy, invert: false },
            ] as const
          ).map((d) => (
            <div key={d.label} style={s.deltaTile}>
              <span style={s.deltaLabel}>{d.label} Δ</span>
              <span style={{ fontSize: 16, fontWeight: 700, color: deltaColor(d.value, d.invert) }}>
                {fmtDeltaPct(d.value)}
              </span>
            </div>
          ))}
          <div style={s.deltaTile}>
            <span style={s.deltaLabel}>{t("dashboard.table.cost")} Δ</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: deltaColor(delta.cost_usd, true) }}>
              {/* E-16 — a null cost renders null, never an invented figure. */}
              {delta.cost_usd == null ? "—" : formatCost(delta.cost_usd)}
            </span>
          </div>
        </div>

        <div style={s.columns}>
          {columns.map((c) => (
            <div key={c.label} style={s.column}>
              <span style={s.columnLabel}>{c.label}</span>
              <div style={s.metaRow}>
                <Badge mono>v{c.batch.agent_version}</Badge>
                <span>{new Date(c.batch.ran_at).toLocaleString()}</span>
              </div>
              <div style={s.metricsRow}>
                <div style={s.metric}>
                  <div style={s.metricLabel}>{t("dashboard.table.recall")}</div>
                  <div style={s.metricValue}>
                    {c.batch.recall != null ? `${Math.round(c.batch.recall * 100)}%` : t("dashboard.na")}
                  </div>
                </div>
                <div style={s.metric}>
                  <div style={s.metricLabel}>{t("dashboard.table.precision")}</div>
                  <div style={s.metricValue}>
                    {c.batch.precision != null ? `${Math.round(c.batch.precision * 100)}%` : t("dashboard.na")}
                  </div>
                </div>
                <div style={s.metric}>
                  <div style={s.metricLabel}>{t("dashboard.table.citation")}</div>
                  <div style={s.metricValue}>
                    {c.batch.citation_accuracy != null
                      ? `${Math.round(c.batch.citation_accuracy * 100)}%`
                      : t("dashboard.na")}
                  </div>
                </div>
                <div style={s.metric}>
                  <div style={s.metricLabel}>{t("dashboard.table.cost")}</div>
                  <div style={s.metricValue}>{formatCost(c.batch.cost_usd)}</div>
                </div>
              </div>
              <div style={s.promptTitle}>{t("compare.promptDiffTitle")}</div>
              {c.prompt == null ? (
                <p style={s.note}>{t("compare.promptUnavailable")}</p>
              ) : (
                <pre style={s.prompt}>{c.prompt}</pre>
              )}
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
