/* DiffViewer — basic GitHub-style unified diff viewer. Renders real PrFile.patch
   (unified-diff text from the F1 API) as a list of collapsible FileCards.
   Optional inline comments (Files changed tab): hover a line → "+" → comment,
   posted live to GitHub; existing GitHub review comments render inline.
   Optional findings: severity markers on lines a finding covers, hover for
   detail. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { PrFile, FindingRecord } from "@devdigest/shared";
import type { FocusFindingsOptions } from "@/lib/types";
import { type DiffCommentApi } from "../comments";
import { s } from "../styles";
import { FileCard } from "../FileCard";

export function DiffViewer({
  files,
  commenting,
  findings = [],
  onFocusFindings,
}: {
  files: PrFile[];
  commenting?: DiffCommentApi;
  findings?: FindingRecord[];
  onFocusFindings?: (opts: FocusFindingsOptions) => void;
}) {
  const t = useTranslations("shell");
  if (!files || files.length === 0) {
    return <div style={s.empty}>{t("diffViewer.noChangedFiles")}</div>;
  }
  return (
    <div style={s.list}>
      {files.map((file, index) => (
        <FileCard key={index} file={file} commenting={commenting} findings={findings} onFocusFindings={onFocusFindings} />
      ))}
    </div>
  );
}
