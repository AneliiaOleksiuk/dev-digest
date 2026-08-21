"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button } from "@devdigest/ui";
import type { EvalCaseRecord, EvalRunRecord } from "@/lib/types";
import { pct } from "../../helpers";
import { s } from "./styles";

/** One eval case row — name, pass/fail + last recall (or "never run"), and
 *  the per-case Run/Edit/Delete actions (AC-35). A row whose
 *  `expectation_status`/`input_status` is `'unusable'` (AC-13, E-12) renders
 *  a clearly-marked badge instead of the pass/fail state — the same
 *  `caseEditor.invalidJson` copy the case-editor's own JSON badge uses,
 *  reused here rather than adding a new i18n key. */
export function CaseRow({
  evalCase,
  lastRun,
  running,
  onRun,
  onEdit,
  onDelete,
}: {
  evalCase: EvalCaseRecord;
  lastRun?: EvalRunRecord;
  running?: boolean;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("eval");
  const unusable = evalCase.expectation_status === "unusable" || evalCase.input_status === "unusable";
  const recall = lastRun ? pct(lastRun.recall) : null;

  return (
    <div style={s.row}>
      <div style={s.main}>
        <span style={s.name}>{evalCase.name}</span>
        {unusable ? (
          <Badge color="var(--crit)">{t("caseEditor.invalidJson")}</Badge>
        ) : !lastRun ? (
          <span style={s.muted}>{t("evalsTab.neverRun")}</span>
        ) : (
          <span style={lastRun.pass ? s.passed : s.failed}>
            {t(lastRun.pass ? "evalsTab.passed" : "evalsTab.failed")}
            {recall != null && t("evalsTab.recallSuffix", { recall })}
          </span>
        )}
      </div>
      <div style={s.actions}>
        <Button kind="ghost" size="sm" icon="Play" disabled={running || unusable} onClick={onRun}>
          {running ? t("evalsTab.running") : t("evalsTab.run")}
        </Button>
        <Button kind="ghost" size="sm" icon="Edit" onClick={onEdit}>
          {t("evalsTab.edit")}
        </Button>
        <Button kind="danger" size="sm" icon="Trash" onClick={onDelete}>
          {t("evalsTab.delete")}
        </Button>
      </div>
    </div>
  );
}
