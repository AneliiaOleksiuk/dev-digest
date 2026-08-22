"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, ErrorState, Icon, Modal, Skeleton } from "@devdigest/ui";
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
  const diffLines = base_prompt != null && head_prompt != null ? promptDiffLines(base_prompt, head_prompt) : null;
  const pct = (v: number | null) => (v != null ? `${Math.round(v * 100)}%` : t("dashboard.na"));
  const metricCards = [
    { key: "recall", label: t("dashboard.table.recall"), base: pct(base.recall), head: pct(head.recall), delta: delta.recall, invert: false },
    { key: "precision", label: t("dashboard.table.precision"), base: pct(base.precision), head: pct(head.precision), delta: delta.precision, invert: false },
    { key: "citation", label: t("dashboard.table.citation"), base: pct(base.citation_accuracy), head: pct(head.citation_accuracy), delta: delta.citation_accuracy, invert: false },
  ] as const;

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

        <div style={s.metaRow}>
          <span>
            <Badge mono>v{base.agent_version}</Badge> {new Date(base.ran_at).toLocaleString()}
          </span>
          <Icon.ArrowRight size={13} />
          <span>
            <Badge mono>v{head.agent_version}</Badge> {new Date(head.ran_at).toLocaleString()}
          </span>
        </div>

        <div style={s.metricCardsRow}>
          {metricCards.map((m) => (
            <div key={m.key} style={s.metricCard}>
              <div style={s.metricCardLabel}>{m.label}</div>
              <div style={s.metricCardValue}>
                <span style={s.metricCardOld}>{m.base}</span>
                <span style={s.metricCardArrow}>→</span>
                <span>{m.head}</span>
              </div>
              <span style={{ ...s.metricCardDelta, color: deltaColor(m.delta, m.invert) }}>
                {fmtDeltaPct(m.delta)}
              </span>
            </div>
          ))}
          <div style={s.metricCard}>
            <div style={s.metricCardLabel}>{t("dashboard.table.cost")}</div>
            <div style={s.metricCardValue}>
              <span style={s.metricCardOld}>{formatCost(base.cost_usd)}</span>
              <span style={s.metricCardArrow}>→</span>
              <span>{formatCost(head.cost_usd)}</span>
            </div>
            <span style={{ ...s.metricCardDelta, color: deltaColor(delta.cost_usd, true) }}>
              {/* E-16 — a null cost renders null, never an invented figure. */}
              {delta.cost_usd == null ? "—" : formatCost(delta.cost_usd)}
            </span>
          </div>
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
