"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, ErrorState, Modal, Skeleton } from "@devdigest/ui";
import { useEvalCompare } from "@/lib/hooks/eval";
import { formatCost } from "@/helpers/format";
import { deltaColor, fmtDeltaPct, promptDiffLines, sameVersionDifferentSkills } from "./helpers";
import { s } from "./styles";

/**
 * Read-only compare view (AC-31/AC-32, D-8/Q-2 — no promote, no revert), a
 * modal opened on top of `AgentEvalDetail` rather than a separate page — the
 * reference mockup shows it as a popup with metric deltas and a prompt diff
 * over the dashboard; only its "Promote" button was deliberately dropped
 * (D-8's own rationale — nothing in this module can act on it).
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
  onClose,
}: {
  agentId: string;
  baseId: string;
  headId: string;
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const { data: comparison, isLoading, isError, refetch } = useEvalCompare(agentId, baseId, headId);

  if (isLoading || !comparison) {
    return (
      <Modal title={t("compare.title")} onClose={onClose}>
        <div style={s.body}>
          <Skeleton height={80} />
          <Skeleton height={220} />
        </div>
      </Modal>
    );
  }
  if (isError) {
    return (
      <Modal title={t("compare.title")} onClose={onClose}>
        <div style={s.body}>
          <ErrorState body="Couldn't load this comparison." onRetry={() => refetch()} />
        </div>
      </Modal>
    );
  }

  const { base, head, delta, base_prompt, head_prompt } = comparison;
  const columns = [
    { label: t("compare.base"), batch: base },
    { label: t("compare.head"), batch: head },
  ];
  const diffLines = base_prompt != null && head_prompt != null ? promptDiffLines(base_prompt, head_prompt) : null;

  return (
    <Modal
      width={920}
      title={t("compare.title")}
      subtitle={`v${base.agent_version} → v${head.agent_version}`}
      onClose={onClose}
    >
      <div style={s.body}>
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
            </div>
          ))}
        </div>

        <div style={s.diffSection}>
          <div style={s.diffHeader}>
            <span style={s.diffTitle}>{t("compare.promptDiffTitle")}</span>
            {diffLines && (
              <div style={s.diffLegend}>
                <span style={s.legendItem}>
                  <span style={s.legendDot("var(--crit)")} />
                  {t("compare.base")} (v{base.agent_version})
                </span>
                <span style={s.legendItem}>
                  <span style={s.legendDot("var(--ok)")} />
                  {t("compare.head")} (v{head.agent_version})
                </span>
              </div>
            )}
          </div>
          {diffLines ? (
            <pre style={s.diffBlock}>
              {diffLines.map((line, i) => (
                <div key={i} style={s.diffLine(line.kind)}>
                  {line.text || " "}
                </div>
              ))}
            </pre>
          ) : base_prompt == null && head_prompt == null ? (
            <p style={s.note}>{t("compare.promptUnavailable")}</p>
          ) : (
            <>
              <pre style={s.diffBlock}>{base_prompt ?? head_prompt}</pre>
              <p style={s.note}>{t("compare.promptUnavailable")}</p>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
