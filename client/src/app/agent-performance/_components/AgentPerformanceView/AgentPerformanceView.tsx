"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useAgentPerf } from "@/lib/hooks/agent-performance";
import { isIncompleteCustomRange, rangeFromSearchParams, rangeToSearchParams, validateCustomRange } from "@/lib/hooks/range";
import { RangeSelector } from "@/components/range-selector";
import { findAgentById, pooledDecided, rankByAcceptRate } from "./helpers";
import { SummaryTiles } from "./_components/SummaryTiles";
import { CostDonuts } from "./_components/CostDonuts";
import { AgentTable } from "./_components/AgentTable";
import { s } from "./styles";

/**
 * SPEC-06 WI11 — the workspace-wide Agent Performance dashboard
 * (`GET /agents/performance`, via `useAgentPerf`). Same `/ci-runs` shape:
 * thin `page.tsx` → this view owns fetch/state/render. AC-33/AC-34/AC-35/
 * NFR-7: loading renders no number, failure renders no tiles/table/donuts,
 * and a whole-workspace empty range (AC-36) is visually distinct from a
 * populated table with a zero-run agent row (AC-37). No write action
 * anywhere on this page (AC-39).
 *
 * Orchestrator only — loading/error/incomplete-range/invalid-range/empty/
 * populated branch logic lives here; the populated branch's own markup is
 * composed from `_components/SummaryTiles`, `_components/CostDonuts`, and
 * `_components/AgentTable` (pr-self-review CRITICAL split, no behavior
 * change — see those files' own doc comments).
 */
export function AgentPerformanceView() {
  const t = useTranslations("agentPerformance");
  const router = useRouter();
  const search = useSearchParams();

  const range = rangeFromSearchParams(search);
  const setRange = (next: typeof range) => {
    router.replace(`/agent-performance?${rangeToSearchParams(search, next).toString()}`);
  };

  const { data, isLoading, isError, refetch } = useAgentPerf(range);

  const rangeLabels = {
    "1d": t("range.1d"),
    "30d": t("range.30d"),
    custom: t("range.custom"),
    customFrom: t("range.customFrom"),
    customTo: t("range.customTo"),
  };

  // fix-loop (A2) — a custom range with only one date entered never reaches
  // the server (useAgentPerf's `enabled` guard) — surface real validation
  // copy instead of the generic error state or a silent blank page.
  const rangeIncomplete = isIncompleteCustomRange(range);
  // fix-loop (Row 12/AC-4) — a COMPLETE custom range that's invalid
  // (start > end, span > 366 days) also never reaches the server (same
  // `enabled` guard, `validateCustomRange`) — without this the generic
  // `loadError` would render for what is really a validation failure.
  const rangeError = validateCustomRange(range);
  const wholeWorkspaceEmpty = !!data && data.summary.runs === 0;
  const mostActiveRow = data ? findAgentById(data.agents, data.summary.most_active_agent_id) : undefined;
  const grouped = data ? rankByAcceptRate(data.agents) : null;
  const pooled = data ? pooledDecided(data.agents) : null;

  return (
    <AppShell crumb={[{ label: t("title") }]}>
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>{t("title")}</h1>
            <p style={s.subtitle}>{t("subtitle")}</p>
          </div>
          <RangeSelector value={range} onChange={setRange} labels={rangeLabels} />
        </div>

        {isLoading && (
          <>
            <div style={s.tiles}>
              <Skeleton height={90} />
              <Skeleton height={90} />
              <Skeleton height={90} />
              <Skeleton height={90} />
            </div>
            <Skeleton height={220} />
          </>
        )}

        {!isLoading && !rangeIncomplete && !rangeError && isError && (
          <ErrorState body={t("loadError")} onRetry={() => refetch()} />
        )}

        {/* fix-loop (A2) — real validation copy for a half-entered custom
            range, instead of the generic error state or a silent blank
            page (the query stays disabled until both dates are set). */}
        {!isLoading && rangeIncomplete && <p style={s.rangeIncomplete}>{t("range.incomplete")}</p>}

        {/* fix-loop (Row 12/AC-4) — real validation copy for a COMPLETE but
            invalid range (start > end, or span > 366 days), instead of
            firing the request and rendering the generic `loadError` when the
            server 422s. */}
        {!isLoading && !rangeIncomplete && rangeError && (
          <p style={s.rangeIncomplete}>
            {rangeError === "startAfterEnd" ? t("range.invalidOrder") : t("range.invalidSpan")}
          </p>
        )}

        {!isLoading && !rangeIncomplete && !rangeError && !isError && wholeWorkspaceEmpty && (
          <EmptyState icon="BarChart" title={t("empty.title")} body={t("empty.body")} />
        )}

        {!isLoading && !rangeIncomplete && !rangeError && !isError && data && !wholeWorkspaceEmpty && grouped && pooled && (
          <>
            <SummaryTiles summary={data.summary} pooled={pooled} mostActiveRow={mostActiveRow} />
            <CostDonuts costByAgent={data.cost_by_agent} costByModel={data.cost_by_model} />
            <AgentTable
              ranked={grouped.ranked}
              lowConfidence={grouped.lowConfidence}
              allLowConfidence={grouped.allLowConfidence}
              range={range}
            />
          </>
        )}
      </div>
    </AppShell>
  );
}
