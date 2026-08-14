/* BriefTimeline — the "Why Timeline" (SPEC-03, D-3: product name stays "Why
   Timeline" in copy; the identifier here is BriefTimeline, never Why*, which
   already means git-blame). A collapsed <details> inside PrBriefCard (Q-3) —
   opening it is what enables the lazy usePrBriefTimeline fetch. Every entry
   already carries its FULL BriefRecord (the "two endpoints, not three"
   decision), so activating an older entry costs zero additional requests and
   zero model calls (AC-15). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, Skeleton } from "@devdigest/ui";
import { usePrBriefTimeline } from "@/lib/hooks/brief";
import type { BriefTimelineEntry } from "@/lib/types";
import { riskLevelMeta, shortSha } from "../../helpers";
import { s } from "./styles";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function BriefTimeline({
  prId,
  selectedHeadSha,
  onSelect,
  onBackToCurrent,
}: {
  prId: string;
  /** The head_sha of the entry currently DISPLAYED as historical, or `null`
   *  when the card is showing the current-head brief. */
  selectedHeadSha: string | null;
  onSelect: (entry: BriefTimelineEntry) => void;
  onBackToCurrent: () => void;
}) {
  const t = useTranslations("brief");
  const [open, setOpen] = React.useState(false);
  const { data, isLoading } = usePrBriefTimeline(prId, { enabled: open });

  return (
    <details
      style={s.details}
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary style={s.summary}>
        {t("timeline.title")}
        {data ? ` (${data.brief_count})` : ""}
      </summary>

      {open &&
        (isLoading ? (
          <div style={{ marginTop: 8 }}>
            <Skeleton height={40} />
          </div>
        ) : !data || data.entries.length === 0 ? (
          <div style={s.empty}>{t("timeline.empty")}</div>
        ) : (
          <>
            <div style={s.disclosure}>
              {t("timeline.disclosure", { briefCount: data.brief_count, commitCount: data.commit_count })}
            </div>
            <ul style={s.list}>
              {data.entries.map((entry) => {
                const meta = riskLevelMeta(entry.risk_level);
                const isSelected = entry.head_sha === (selectedHeadSha ?? undefined);
                const isCurrentView = entry.is_current_head && selectedHeadSha == null;
                return (
                  <li key={entry.head_sha}>
                    <button
                      type="button"
                      style={{ ...s.row, ...(isSelected || isCurrentView ? s.rowSelected : {}) }}
                      onClick={() => (entry.is_current_head ? onBackToCurrent() : onSelect(entry))}
                    >
                      <span style={s.sha}>{shortSha(entry.head_sha)}</span>
                      <Badge color={meta.color} bg={meta.bg}>
                        {t(`card.riskLevel.${entry.risk_level}`)}
                      </Badge>
                      {entry.risk_changed && (
                        <span style={s.changedMark}>
                          <Icon.TrendingUp size={11} style={{ verticalAlign: "-1px" }} /> {t("timeline.riskChanged")}
                        </span>
                      )}
                      <span style={s.time}>{formatDate(entry.generated_at)}</span>
                      {entry.is_current_head && <span style={s.currentTag}>{t("timeline.current")}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        ))}
    </details>
  );
}
