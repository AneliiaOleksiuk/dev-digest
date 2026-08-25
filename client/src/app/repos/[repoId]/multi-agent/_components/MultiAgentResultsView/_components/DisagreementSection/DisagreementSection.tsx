/* DisagreementSection — "where agents disagree" block (WI13). One row per
   contended `file:line`, one cell per participating agent: either a severity
   chip, or a deliberately-styled "did not flag" cell carrying the take's own
   short note — dashed border + muted note text so it reads as intentional,
   not like an empty/broken cell. Location-only matching here is deliberately
   LOOSER than `FindingGroupsSection`'s category-matched grouping — the same
   finding can appear in one view but not the other, by design (not a bug). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SeverityBadge, Toggle, type Severity } from "@devdigest/ui";
import type { Conflict } from "@devdigest/shared";
import { filterConflicts } from "./helpers";
import { s } from "./styles";

export function DisagreementSection({ conflicts }: { conflicts: Conflict[] }) {
  const t = useTranslations("runs");
  const [onlyConflicts, setOnlyConflicts] = React.useState(false);
  const shown = filterConflicts(conflicts, onlyConflicts);

  return (
    <div style={s.root}>
      <div style={s.head}>
        <div style={s.title}>{t("conflicts.title")}</div>
        <div style={s.toggleRow}>
          <Toggle on={onlyConflicts} onChange={setOnlyConflicts} />
          <span onClick={() => setOnlyConflicts((v) => !v)} style={{ cursor: "pointer" }}>
            {t("conflicts.onlyConflicts")}
          </span>
        </div>
      </div>
      {shown.length === 0 ? (
        <div style={s.empty}>{t("conflicts.empty")}</div>
      ) : (
        shown.map((c) => (
          <div key={`${c.file}:${c.line}`} style={s.row}>
            <div className="mono" style={s.rowHead}>
              {c.file}:{c.line} — {c.title}
            </div>
            <div style={s.cells}>
              {c.takes.map((take) =>
                take.verdict === "ignored" ? (
                  <div key={take.agent_id} style={s.ignoredCell}>
                    <span style={s.persona}>{take.persona}</span>
                    <span>{t("conflicts.didNotFlag")}</span>
                    {take.note && <span style={s.note}>{take.note}</span>}
                  </div>
                ) : (
                  <div key={take.agent_id} style={s.flaggedCell("var(--border-strong)")}>
                    <span style={s.persona}>{take.persona}</span>
                    <SeverityBadge severity={take.verdict as Severity} compact />
                    {take.note && <span style={s.note}>{take.note}</span>}
                  </div>
                ),
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
