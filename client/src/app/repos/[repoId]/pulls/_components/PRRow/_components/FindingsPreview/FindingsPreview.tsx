/* FindingsPreview — hovering a PR list row's findings counters opens a small
   popover listing that PR's (latest review's) findings, read-only, without
   leaving the list. Clicking a finding (or a counter, or "view all") lands on
   the PR detail page's Findings tab, deep-linked to that run/severity/finding. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { SeverityBadge, CategoryTag, Skeleton, type Severity, type Category } from "@devdigest/ui";
import type { PrMeta } from "@/lib/types";
import { Popover } from "@/components/popover";
import { SeverityBadgeRow, type SeverityCounts } from "@/components/severity-badge-button";
import { usePrLatestFindings } from "@/lib/hooks/reviews";
import { s } from "./styles";

export function FindingsPreview({ pullRequest, repoId }: { pullRequest: PrMeta; repoId: string }) {
  const t = useTranslations("prReview");
  const router = useRouter();
  const { id, number, critical_count, warning_count, suggestion_count } = pullRequest;
  const [isHovering, setIsHovering] = React.useState(false);
  const { data: reviews, isLoading } = usePrLatestFindings(id, { enabled: isHovering });
  const [latestReview] = reviews ?? [];
  const latestFindings = latestReview?.findings ?? [];

  const severityCounts: SeverityCounts = {
    CRITICAL: critical_count,
    WARNING: warning_count,
    SUGGESTION: suggestion_count,
  };

  const navigateToFindings = ({ findingId, severity }: { findingId?: string; severity?: string } = {}) => {
    const searchParams = new URLSearchParams({ tab: "findings" });
    if (latestReview?.run_id) searchParams.set("run", latestReview.run_id);
    if (severity) searchParams.set("severity", severity);
    if (findingId) searchParams.set("finding", findingId);
    router.push(`/repos/${repoId}/pulls/${number}?${searchParams.toString()}`);
  };

  return (
    <Popover
      onOpenChange={setIsHovering}
      panelStyle={s.panel}
      trigger={
        <SeverityBadgeRow
          counts={severityCounts}
          labelFor={(severity) => t("timeline.filterBySeverity", { severity })}
          onClick={(severity) => navigateToFindings({ severity })}
        />
      }
    >
      <div style={s.content} onClick={(event) => event.stopPropagation()}>
        <div style={s.heading}>{t("list.findingsPreview.heading", { count: latestFindings.length })}</div>
        <div style={s.list}>
          {isLoading && (
            <>
              <Skeleton height={44} />
              <Skeleton height={44} />
              <Skeleton height={44} />
            </>
          )}
          {!isLoading && latestFindings.length === 0 && <div style={s.empty}>{t("list.findingsPreview.empty")}</div>}
          {!isLoading &&
            latestFindings.map(({ id: findingId, severity, title, category, file, start_line, rationale }) => (
              <button key={findingId} type="button" onClick={() => navigateToFindings({ findingId })} style={s.row}>
                <SeverityBadge severity={severity as Severity} compact />
                <div style={s.rowMain}>
                  <div style={s.rowTitleLine}>
                    <span style={s.rowTitle}>{title}</span>
                    <CategoryTag category={category as Category} />
                  </div>
                  <div style={s.rowMeta}>
                    {file}:{start_line}
                  </div>
                  <div style={s.rowSnippet}>{rationale}</div>
                </div>
              </button>
            ))}
        </div>
        <div style={s.footer}>
          <button type="button" onClick={() => navigateToFindings()} style={s.footerLink}>
            {t("list.findingsPreview.viewAll")}
          </button>
        </div>
      </div>
    </Popover>
  );
}
