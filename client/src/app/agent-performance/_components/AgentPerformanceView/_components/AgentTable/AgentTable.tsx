"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge, Icon } from "@devdigest/ui";
import type { AgentPerfRow } from "@devdigest/shared";
import type { RangeQuery } from "@/lib/hooks/range";
import { formatCost, formatDurationMs, formatPercent } from "@/helpers/format";
import { acceptRateColor, agentDetailHref, formatLastRunAt } from "../../helpers";
import { s } from "../../styles";

/**
 * One `<tr>`, shared by both the ranked and low-confidence sections of
 * `AgentTable` below — before this split the same ~20 lines of row markup
 * existed twice (once per section), differing only in whether a zero-runs
 * `Badge` renders. `showZeroBadge` mirrors the original branching exactly:
 * only the low-confidence section ever passes it, since a ranked row can
 * never legitimately be a 0-run agent (a ranked agent has >=
 * LOW_CONFIDENCE_THRESHOLD decided findings, which requires runs > 0).
 */
function Row({
  row,
  range,
  showZeroBadge = false,
}: {
  row: AgentPerfRow;
  range: RangeQuery;
  showZeroBadge?: boolean;
}) {
  const t = useTranslations("agentPerformance");
  return (
    <tr>
      <td style={s.td}>
        <span style={s.agentCell}>
          <span style={s.agentIcon}>
            <Icon.Cpu size={12} />
          </span>
          {row.agent_name}
          {showZeroBadge && row.runs === 0 && <Badge color="var(--text-muted)">{t("zeroRuns")}</Badge>}
        </span>
      </td>
      <td style={s.td}>{row.runs}</td>
      <td style={s.td}>{formatCost(row.avg_cost_usd)}</td>
      <td style={s.td}>{formatDurationMs(row.avg_latency_ms)}</td>
      <td style={s.td}>
        <span style={{ color: acceptRateColor(row.accept_rate) }}>{formatPercent(row.accept_rate)}</span>
      </td>
      <td style={s.td}>{formatLastRunAt(row.last_run_at)}</td>
      <td style={s.td}>
        <Link href={agentDetailHref(row.agent_id, range)}>{t("view")}</Link>
      </td>
    </tr>
  );
}

/**
 * AgentPerformanceView's per-agent table — ranked section + an optional
 * low-confidence group (AC-31/AC-32) behind a spanning group-label row.
 * Extracted verbatim from AgentPerformanceView's populated-state branch —
 * pure structural split, no behavior change.
 */
export function AgentTable({
  ranked,
  lowConfidence,
  allLowConfidence,
  range,
}: {
  ranked: AgentPerfRow[];
  lowConfidence: AgentPerfRow[];
  allLowConfidence: boolean;
  range: RangeQuery;
}) {
  const t = useTranslations("agentPerformance");
  return (
    <div style={s.section}>
      <div style={s.sectionTitle}>{t("perAgent")}</div>
      {/* C1 fix-loop — ONE <table> with two <tbody> sections (ranked, then
          low-confidence behind a spanning group-label row), instead of two
          separate <table> elements that can't share column sizing. A single
          table sizes its columns from the UNION of every row in it, so the
          ranked and low-confidence sections' columns align by construction —
          no `tableLayout: fixed` / matching-width bookkeeping needed. */}
      <div style={s.tableWrap}>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>{t("table.agent")}</th>
              <th style={s.th}>{t("table.runs")}</th>
              <th style={s.th}>{t("table.avgCost")}</th>
              <th style={s.th}>{t("table.avgDuration")}</th>
              <th style={s.th}>{t("table.accept")}</th>
              <th style={s.th}>{t("table.lastRun")}</th>
              <th style={s.th} />
            </tr>
          </thead>
          <tbody>
            {ranked.map((row) => (
              <Row key={row.agent_id} row={row} range={range} />
            ))}
          </tbody>

          {lowConfidence.length > 0 && (
            <tbody>
              <tr>
                <td style={s.groupLabelCell} colSpan={7}>
                  {t("lowConfidenceGroup")}
                </td>
              </tr>
              {lowConfidence.map((row) => (
                <Row key={row.agent_id} row={row} range={range} showZeroBadge />
              ))}
            </tbody>
          )}
        </table>
      </div>

      {allLowConfidence && lowConfidence.length > 0 && <p style={s.muted}>{t("notRankable")}</p>}
    </div>
  );
}
