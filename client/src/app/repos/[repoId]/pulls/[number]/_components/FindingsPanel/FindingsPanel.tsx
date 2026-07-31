/* FindingsPanel — hide-low-confidence + severity filter + j/k navigation +
   FindingCard list, wiring the accept/dismiss action hook (A2). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Toggle, EmptyState } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { FindingCard } from "../FindingCard";
import { useFindingAction } from "../../../../../../../lib/hooks/reviews";
import { KEY_TO_ACTION } from "./constants";
import { visibleFindings, filterBySeverity } from "./helpers";
import { s } from "./styles";

export function FindingsPanel({
  findings,
  prId,
  repoFullName,
  headSha,
  severityFilter = null,
  targetFindingId = null,
  onClearFilter,
}: {
  findings: FindingRecord[];
  prId: string;
  repoFullName?: string | null;
  headSha?: string | null;
  /** Show only findings of this severity — driven by a clicked findings counter. */
  severityFilter?: string | null;
  /** Scroll to + highlight this one finding. */
  targetFindingId?: string | null;
  onClearFilter?: () => void;
}) {
  const t = useTranslations("prReview");
  const action = useFindingAction();
  const [hideLow, setHideLow] = React.useState(false);
  const [focusedIndex, setFocusedIndex] = React.useState(0);

  const shown = React.useMemo(
    () => filterBySeverity(visibleFindings(findings, hideLow), severityFilter),
    [findings, hideLow, severityFilter],
  );

  React.useEffect(() => {
    if (!targetFindingId) return;
    document.querySelector(`[data-finding-id="${targetFindingId}"]`)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [targetFindingId]);

  // j/k navigation + a/d shortcuts on the focused finding (keyboard).
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const targetTag = (event.target as HTMLElement)?.tagName;
      if (targetTag === "INPUT" || targetTag === "TEXTAREA") return;
      const focusedFinding = shown[focusedIndex];
      if (event.key === "j") setFocusedIndex((index) => Math.min(index + 1, shown.length - 1));
      else if (event.key === "k") setFocusedIndex((index) => Math.max(index - 1, 0));
      else if (KEY_TO_ACTION[event.key] && focusedFinding) {
        action.mutate({ findingId: focusedFinding.id, action: KEY_TO_ACTION[event.key]!, prId });
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [shown, focusedIndex, action, prId]);

  return (
    <div>
      <div style={s.toolbar}>
        {severityFilter && (
          <div style={s.filterChip}>
            <span>{t("panel.filteredBy", { count: shown.length, severity: severityFilter })}</span>
            <button type="button" onClick={onClearFilter} style={s.filterChipClear}>
              {t("panel.clearFilter")}
            </button>
          </div>
        )}
        <div style={s.toggleGroup}>
          {t("panel.hideLowConfidence")}
          <Toggle on={hideLow} onChange={setHideLow} size={16} />
        </div>
      </div>

      <div style={s.list}>
        {shown.length === 0 ? (
          <EmptyState icon="Filter" title={t("panel.noMatchTitle")} body={t("panel.noMatchBody")} />
        ) : (
          shown.map((finding, index) => (
            <FindingCard
              key={finding.id}
              finding={finding}
              focused={index === focusedIndex}
              defaultExpanded={index === 0}
              forceExpanded={finding.id === targetFindingId}
              highlighted={finding.id === targetFindingId}
              pending={action.isPending}
              repoFullName={repoFullName}
              headSha={headSha}
              onAction={(actionKind) => action.mutate({ findingId: finding.id, action: actionKind, prId })}
            />
          ))
        )}
      </div>
    </div>
  );
}
