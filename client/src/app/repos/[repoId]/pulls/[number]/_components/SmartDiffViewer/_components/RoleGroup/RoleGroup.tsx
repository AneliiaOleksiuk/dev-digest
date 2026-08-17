"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { FindingRecord, PrFile, SmartDiffFile, SmartDiffRole } from "@devdigest/shared";
import { FileCard } from "@/components/diff-viewer/FileCard";
import type { DiffCommentApi } from "@/components/diff-viewer";
import type { FocusFindingsOptions } from "@/lib/types";
import { ROLE_COLOR, s } from "../../styles";
import { summaryFromPatch } from "../../summaryFromPatch";

/** Core files always start open; files with findings open; wiring/boilerplate stay collapsed. */
function defaultFileOpen(role: SmartDiffRole, file: SmartDiffFile): boolean {
  if (file.finding_lines.length > 0) return true;
  return role === "core";
}

export function RoleGroup({
  role,
  files,
  fileByPath,
  findings,
  commenting,
  onFocusFindings,
  openMap,
  setFileOpen,
  onJumpToLine,
  groupOpen,
  setGroupOpen,
}: {
  role: SmartDiffRole;
  files: SmartDiffFile[];
  fileByPath: Map<string, PrFile>;
  findings: FindingRecord[];
  commenting?: DiffCommentApi;
  onFocusFindings?: (opts: FocusFindingsOptions) => void;
  openMap: Record<string, boolean>;
  setFileOpen: (path: string, open: boolean) => void;
  onJumpToLine: (path: string, line: number) => void;
  /** Group collapse state is owned by SmartDiffViewer (not this component)
   *  so that `onJumpToLine`/externalFocus can force a collapsed group open
   *  before scrolling to a file inside it (SPEC-03 AC-30). */
  groupOpen: boolean;
  setGroupOpen: (open: boolean) => void;
}) {
  const t = useTranslations("prReview");

  const findingCount = files.reduce((n, f) => n + f.finding_lines.length, 0);
  const label =
    role === "core"
      ? t("smartDiff.coreLabel")
      : role === "wiring"
        ? t("smartDiff.wiringLabel")
        : t("smartDiff.boilerplateLabel");
  const subtitle = t(`smartDiff.subtitle.${role}`);

  return (
    <div style={s.group}>
      <div
        style={s.groupHeader}
        onClick={() => setGroupOpen(!groupOpen)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setGroupOpen(!groupOpen);
          }
        }}
      >
        <Icon.ChevronRight
          size={13}
          style={{ transform: groupOpen ? "rotate(90deg)" : undefined, color: "var(--text-muted)", flexShrink: 0 }}
        />
        <span style={{ ...s.roleDot, background: ROLE_COLOR[role] }} aria-hidden />
        <div style={s.groupTitleRow}>
          <span style={s.groupTitle}>{label}</span>
          <span style={s.groupSubtitle}>{subtitle}</span>
        </div>
        <div style={s.groupMeta}>
          {findingCount > 0 && <span>{t("smartDiff.findingsBadge", { count: findingCount })}</span>}
          <span>{t("smartDiff.filesCount", { count: files.length })}</span>
        </div>
      </div>

      {groupOpen && (
        <div style={s.files}>
          {files.map((smartFile) => {
            const prFile = fileByPath.get(smartFile.path) ?? {
              path: smartFile.path,
              additions: smartFile.additions,
              deletions: smartFile.deletions,
              patch: null,
            };
            const open = openMap[smartFile.path] ?? defaultFileOpen(role, smartFile);
            const summary =
              smartFile.pseudocode_summary?.trim() ||
              summaryFromPatch(prFile.patch) ||
              t("smartDiff.summaryFallback", {
                path: smartFile.path.split("/").pop() ?? smartFile.path,
                additions: smartFile.additions,
                deletions: smartFile.deletions,
              });
            return (
              <FileCard
                key={smartFile.path}
                file={prFile}
                commenting={commenting}
                findings={findings}
                onFocusFindings={onFocusFindings}
                open={open}
                onOpenChange={(next) => setFileOpen(smartFile.path, next)}
                findingLines={smartFile.finding_lines}
                onJumpToFindingLine={(line) => onJumpToLine(smartFile.path, line)}
                fileSummary={summary}
                summaryBadgeLabel={t("smartDiff.summaryBadge")}
                whatThisDoesLabel={t("smartDiff.whatThisDoes")}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

export { defaultFileOpen };
