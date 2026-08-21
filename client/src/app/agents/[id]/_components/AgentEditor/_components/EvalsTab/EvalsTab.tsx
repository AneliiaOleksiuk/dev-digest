"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, MetricCard, Skeleton } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import {
  useAgentEvalCases,
  useAgentEvalDashboard,
  useDeleteEvalCase,
  useEvalBatches,
  useRunEvalCase,
  useRunEvalSet,
} from "@/lib/hooks/eval";
import { formatCost } from "@/helpers/format";
import { notify } from "@/lib/toast";
import { CaseEditorModal } from "./_components/CaseEditorModal";
import { CaseRow } from "./_components/CaseRow";
import { buildLastRunByCase } from "./helpers";
import { s } from "./styles";

/** Bounds the number of `GET /eval-batches/:id` reads the tab makes to
 *  reconstruct "last run per case" — see helpers.ts's doc comment. */
const RECENT_BATCHES_FOR_LAST_RUN = 5;

function errMsg(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * Evals tab in the Agent Editor (AC-34/AC-35) — this agent's current
 * metrics + case list, "New case", per-case Run/Edit/Delete, and "Run eval"
 * for the whole set. A case whose owner agent no longer exists (E-15)
 * cannot reach this tab at all (it's rendered FOR a live `agent` prop) —
 * that edge case is handled on the workspace-wide Eval Dashboard (WI13)
 * instead, which lists owners that may no longer resolve to a live agent.
 */
export function EvalsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("eval");
  const { data: cases } = useAgentEvalCases(agent.id);
  const { data: dashboard } = useAgentEvalDashboard(agent.id);
  const runSet = useRunEvalSet();
  const runCase = useRunEvalCase();
  const deleteCase = useDeleteEvalCase();

  const recentBatchIds = React.useMemo(
    () => (dashboard?.recent_runs ?? []).slice(0, RECENT_BATCHES_FOR_LAST_RUN).map((b) => b.id),
    [dashboard],
  );
  const batchQueries = useEvalBatches(recentBatchIds);
  const batchData = batchQueries.map((q) => q.data);
  // No useMemo here — `batchData` (size <= RECENT_BATCHES_FOR_LAST_RUN) as a
  // dependency array is invalid (React requires a constant-size deps array),
  // and the fold itself is a cheap O(<=5) walk, so recomputing every render
  // is fine.
  const lastRunByCase = buildLastRunByCase(batchData);

  const [editing, setEditing] = React.useState<"new" | string | null>(null);

  if (!cases || !dashboard) {
    return (
      <div style={s.wrap}>
        <Skeleton height={90} />
        <Skeleton height={200} />
      </div>
    );
  }

  const editingCase = editing && editing !== "new" ? cases.find((c) => c.id === editing) : undefined;
  const isFirstRun = dashboard.delta === null && (dashboard.recent_runs?.length ?? 0) <= 1;

  // `current.*` is sourced from `recent_runs[0]` server-side (see
  // AgentEvalDetail's identical comment) — that same batch's own
  // `*_cases`/`cases_total` is the honest contributing-case count for the
  // metric shown here (AC-30, UX-5), not `dashboard.cases_total`.
  const latestBatch = dashboard.recent_runs[0];
  const metrics = [
    {
      key: "recall",
      label: t("dashboard.metrics.recall"),
      value: dashboard.current.recall,
      delta: dashboard.delta?.recall,
      cases: latestBatch?.recall_cases,
    },
    {
      key: "precision",
      label: t("dashboard.metrics.precision"),
      value: dashboard.current.precision,
      delta: dashboard.delta?.precision,
      cases: latestBatch?.precision_cases,
    },
    {
      key: "citation",
      label: t("dashboard.metrics.citationAccuracy"),
      value: dashboard.current.citation_accuracy,
      delta: dashboard.delta?.citation_accuracy,
      cases: latestBatch?.citation_cases,
    },
  ] as const;

  return (
    <div style={s.wrap}>
      {editing && (
        <CaseEditorModal
          agentId={agent.id}
          evalCase={editingCase}
          lastRun={editingCase ? lastRunByCase.get(editingCase.id) : undefined}
          onClose={() => setEditing(null)}
        />
      )}

      <div>
        <h3 style={s.title}>{t("evalsTab.metricsTitle")}</h3>
        <p style={s.subtitle}>{t("evalsTab.metricsSubtitle")}</p>
      </div>

      <div style={s.metricsRow}>
        {metrics.map((m) => (
          <div key={m.key} style={s.metricWrap}>
            <MetricCard
              label={m.label}
              value={m.value != null ? `${Math.round(m.value * 100)}%` : t("dashboard.na")}
              delta={!isFirstRun ? (m.delta ?? undefined) : undefined}
            />
            {m.value == null && dashboard.cases_total > 0 && <p style={s.naNote}>{t("dashboard.naReason")}</p>}
            {latestBatch && (
              <p style={s.naNote}>
                {t("dashboard.metricCasesCaption", { count: m.cases, total: latestBatch.cases_total })}
              </p>
            )}
          </div>
        ))}
      </div>
      {/* E-17/UX-12 — a first batch is "nothing to compare yet", never a
         zero delta (plain text: not in AC-41's enumerated new-key list). */}
      {isFirstRun && dashboard.cases_total > 0 && <p style={s.firstRunNote}>{t("compare.firstRunNothing")}</p>}
      <p style={s.relativeNote}>{t("dashboard.relativeScoresNote")}</p>

      <div style={s.casesHeader}>
        <h3 style={s.title}>{t("evalsTab.casesHeading")}</h3>
        <div style={s.casesHeaderActions}>
          {cases.length > 0 && (
            <span style={s.estimate}>
              {t("dashboard.runEstimate", { calls: cases.length, cost: formatCost(dashboard.current.cost_usd) })}
            </span>
          )}
          <Button kind="secondary" size="sm" icon="Plus" onClick={() => setEditing("new")}>
            {t("evalsTab.newCase")}
          </Button>
          <Button
            kind="primary"
            size="sm"
            icon="Play"
            disabled={cases.length === 0 || runSet.isPending}
            onClick={() =>
              runSet.mutate(agent.id, { onError: (err) => notify.error(errMsg(err, "Run failed")) })
            }
          >
            {runSet.isPending ? t("dashboard.running") : t("dashboard.runEval", { count: cases.length })}
          </Button>
        </div>
      </div>

      {cases.length === 0 ? (
        <EmptyState icon="FlaskConical" title={t("evalsTab.emptyCases")} />
      ) : (
        <div style={s.list}>
          {cases.map((c) => (
            <CaseRow
              key={c.id}
              evalCase={c}
              lastRun={lastRunByCase.get(c.id)}
              running={runCase.isPending}
              onRun={() =>
                runCase.mutate(
                  { caseId: c.id, ownerId: agent.id },
                  { onError: (err) => notify.error(errMsg(err, "Run failed")) },
                )
              }
              onEdit={() => setEditing(c.id)}
              onDelete={() =>
                deleteCase.mutate(
                  { id: c.id, ownerId: agent.id },
                  { onError: (err) => notify.error(errMsg(err, "Delete failed")) },
                )
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
