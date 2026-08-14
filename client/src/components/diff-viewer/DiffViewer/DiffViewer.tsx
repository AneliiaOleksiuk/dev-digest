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
import type { FocusDiffLineOptions, FocusFindingsOptions } from "@/lib/types";
import { type DiffCommentApi } from "../comments";
import { s } from "../styles";
import { FileCard } from "../FileCard";

export function DiffViewer({
  files,
  commenting,
  findings = [],
  onFocusFindings,
  focus,
}: {
  files: PrFile[];
  commenting?: DiffCommentApi;
  findings?: FindingRecord[];
  onFocusFindings?: (opts: FocusFindingsOptions) => void;
  /** A `path:line` to expand-then-scroll to (SPEC-03 AC-30/E-22 — this
   *  viewer had no jump capability at all before). Implemented as an
   *  optional focus OVERLAY, not by lifting every file into controlled
   *  state: only the focused file is forced open via `FileCard`'s existing
   *  controlled `open`/`onOpenChange` props; every other file keeps its
   *  normal uncontrolled `AUTO_EXPAND_MAX_LINES` default. `null`/`undefined`
   *  — no pending focus. */
  focus?: FocusDiffLineOptions | null;
}) {
  const t = useTranslations("shell");
  // Only the focused file's `open` is ever forced — everything else stays
  // uncontrolled (`openProp={undefined}` in FileCard), so unfocused files
  // keep their default auto-expand behaviour unchanged.
  const [forcedOpenPath, setForcedOpenPath] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!focus) return;
    if (!files.some((f) => f.path === focus.path)) return; // no-op when absent
    setForcedOpenPath(focus.path);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-diff-line="${focus.path}:${focus.line}"]`);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.path, focus?.line]);

  if (!files || files.length === 0) {
    return <div style={s.empty}>{t("diffViewer.noChangedFiles")}</div>;
  }
  return (
    <div style={s.list}>
      {files.map((file, index) => {
        const isForced = forcedOpenPath === file.path;
        return (
          <FileCard
            key={index}
            file={file}
            commenting={commenting}
            findings={findings}
            onFocusFindings={onFocusFindings}
            {...(isForced
              ? {
                  open: true,
                  onOpenChange: (open: boolean) => {
                    if (!open) setForcedOpenPath(null);
                  },
                }
              : {})}
          />
        );
      })}
    </div>
  );
}
