/* FileCard — one collapsible file in the diff: header (path, +/- stat, comment
   count, finding severity badges) and, when open, its parsed lines plus any
   outdated comments. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SEV } from "@devdigest/ui";
import type { PrFile, FindingRecord } from "@devdigest/shared";
import { AUTO_EXPAND_MAX_LINES } from "../constants";
import { parsePatch, type Line } from "../helpers";
import {
  buildThreads,
  keysForLine,
  partitionThreads,
  type CommentThread,
  type DiffCommentApi,
} from "../comments";
import { mostSevereFinding, addedLineSet, newSideLineSet, resolveFindingLine, severityCountsForFile } from "../findings";
import { SeverityBadgeRow } from "@/components/severity-badge-button";
import type { FocusFindingsOptions } from "@/lib/types";
import { s, chevronFor } from "../styles";
import { CodeLine } from "../CodeLine";
import { OutdatedComments } from "../OutdatedComments";

/** Threads anchored to a given parsed line (RIGHT=new, LEFT=old). */
function threadsForLine(line: Line, matched: Map<string, CommentThread[]>): CommentThread[] {
  if (matched.size === 0) return [];
  const out: CommentThread[] = [];
  for (const key of keysForLine(line)) {
    const list = matched.get(key);
    if (list) out.push(...list);
  }
  return out;
}

export function FileCard({
  file,
  commenting,
  findings = [],
  onFocusFindings,
  open: openProp,
  onOpenChange,
  findingLines,
  onJumpToFindingLine,
  fileSummary,
  summaryBadgeLabel,
  whatThisDoesLabel,
}: {
  file: PrFile;
  commenting?: DiffCommentApi;
  findings?: FindingRecord[];
  onFocusFindings?: (opts: FocusFindingsOptions) => void;
  /** When set, expand/collapse is fully controlled by the parent. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Scroll-anchor line numbers (Smart Diff finding_lines). */
  findingLines?: number[];
  onJumpToFindingLine?: (line: number) => void;
  /** Optional per-file "What this does" text (Smart Diff). */
  fileSummary?: string | null;
  summaryBadgeLabel?: string;
  whatThisDoesLabel?: string;
}) {
  const t = useTranslations("shell");
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(
    (file.additions ?? 0) + (file.deletions ?? 0) <= AUTO_EXPAND_MAX_LINES
  );
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : uncontrolledOpen;
  const setOpen = (next: boolean | ((prev: boolean) => boolean)) => {
    const value = typeof next === "function" ? next(open) : next;
    if (controlled) onOpenChange?.(value);
    else setUncontrolledOpen(value);
  };
  const [showSummary, setShowSummary] = React.useState(true);
  const lines = React.useMemo(() => parsePatch(file.patch), [file.patch]);
  const addedLines = React.useMemo(() => addedLineSet(lines), [lines]);
  const allNewSide = React.useMemo(() => newSideLineSet(lines), [lines]);
  const fileFindings = React.useMemo(
    () => findings.filter(({ file: findingFile }) => findingFile === file.path),
    [findings, file.path],
  );
  const severityCounts = React.useMemo(() => severityCountsForFile(findings, file.path), [findings, file.path]);
  const topFinding = React.useMemo(() => mostSevereFinding(fileFindings), [fileFindings]);
  const resolvedJumpLine = React.useMemo(() => {
    if (topFinding) {
      return resolveFindingLine(
        addedLines,
        topFinding.start_line,
        topFinding.end_line ?? topFinding.start_line,
        allNewSide,
      );
    }
    if (findingLines?.length) {
      for (const candidate of findingLines) {
        const hit = resolveFindingLine(addedLines, candidate, candidate, allNewSide);
        if (hit != null) return hit;
      }
    }
    return null;
  }, [topFinding, findingLines, addedLines, allNewSide]);

  // Group this file's comments into threads, then split into ones we can anchor
  // to a rendered line vs. "outdated" (GitHub dropped the line / it's not here).
  const comments = commenting?.comments;
  const { matched, outdated } = React.useMemo(() => {
    if (!comments) return { matched: new Map<string, CommentThread[]>(), outdated: [] };
    const fileThreads = buildThreads(comments.filter((comment) => comment.path === file.path));
    const renderedKeys = new Set<string>();
    for (const line of lines) for (const key of keysForLine(line)) renderedKeys.add(key);
    return partitionThreads(fileThreads, renderedKeys);
  }, [comments, file.path, lines]);

  const commentCount = commenting
    ? commenting.comments.filter((comment) => comment.path === file.path).length
    : 0;

  const hasFindingMarker = fileFindings.length > 0 || (findingLines?.length ?? 0) > 0;
  const statusColor =
    (topFinding && SEV[topFinding.severity as keyof typeof SEV]?.c) ||
    (hasFindingMarker ? "var(--crit, #ef4444)" : undefined);
  const jumpLine = resolvedJumpLine;
  const summaryText = fileSummary?.trim() ? fileSummary.trim() : null;
  const smartMode = fileSummary !== undefined;
  const showsBadge = smartMode && summaryText != null;

  return (
    <div style={s.fileCard}>
      <div onClick={() => setOpen((o) => !o)} style={s.fileHeader}>
        <Icon.ChevronRight size={13} style={chevronFor(open)} />
        <Icon.FileText size={14} style={s.fileIcon} />
        <span className="mono" style={s.filePath}>
          {file.path}
        </span>
        {(open || hasFindingMarker) && (
          <button
            type="button"
            title={jumpLine != null ? `Line ${jumpLine}` : undefined}
            aria-label={jumpLine != null ? `Jump to line ${jumpLine}` : "Open file"}
            onClick={(e) => {
              e.stopPropagation();
              setOpen(true);
              if (jumpLine != null) onJumpToFindingLine?.(jumpLine);
            }}
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              border: "none",
              padding: 0,
              background: statusColor ?? "var(--crit, #ef4444)",
              cursor: onJumpToFindingLine && jumpLine != null ? "pointer" : "default",
              flexShrink: 0,
            }}
          />
        )}
        {showsBadge && (
          <button
            type="button"
            aria-pressed={showSummary}
            aria-label={summaryBadgeLabel ?? "summary"}
            onClick={(e) => {
              e.stopPropagation();
              setShowSummary((v) => !v);
              if (!open) setOpen(true);
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              flexShrink: 0,
              marginLeft: "auto",
              padding: "3px 9px",
              borderRadius: 6,
              border: "none",
              background: showSummary
                ? "color-mix(in srgb, var(--accent, #3b82f6) 18%, transparent)"
                : "transparent",
              color: "var(--accent-text, #93c5fd)",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
              textTransform: "lowercase",
            }}
          >
            <Icon.Sparkles size={11} />
            {summaryBadgeLabel ?? "summary"}
          </button>
        )}
        <span className="mono tnum" style={showsBadge ? s.fileStat : { ...s.fileStat, marginLeft: "auto" }}>
          <span style={s.addText}>+{file.additions}</span>{" "}
          <span style={s.delText}>−{file.deletions}</span>
        </span>
        {commentCount > 0 && (
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text-muted)" }}
          >
            <Icon.MessageSquare size={12} />
            {commentCount}
          </span>
        )}
        {!smartMode && fileFindings.length > 0 && onFocusFindings && (
          <SeverityBadgeRow
            counts={severityCounts}
            labelFor={(severity) => t("diffViewer.filterBySeverity", { severity })}
            onClick={(severity) => onFocusFindings({ severity })}
          />
        )}
      </div>
      {open && (
        <div style={s.fileBody}>
          {smartMode && showSummary && summaryText && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                margin: "0 12px 8px",
                padding: "8px 10px",
                borderRadius: 6,
                background: "color-mix(in srgb, var(--accent, #3b82f6) 10%, var(--bg-subtle, var(--bg)))",
                border: "none",
                fontSize: 12,
                lineHeight: 1.45,
                color: "var(--text-secondary)",
              }}
            >
              <Icon.Sparkles size={14} style={{ color: "var(--accent-text, #93c5fd)", flexShrink: 0 }} />
              <span style={{ fontWeight: 600, color: "var(--text-primary)", flexShrink: 0 }}>
                {whatThisDoesLabel ?? "What this does:"}{" "}
              </span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summaryText}</span>
            </div>
          )}
          {lines.length === 0 ? (
            <div style={s.noDiff}>{t("diffViewer.noDiffText")}</div>
          ) : (
            lines.map((line, index) => (
              <CodeLine
                key={index}
                line={line}
                path={file.path}
                threads={threadsForLine(line, matched)}
                commenting={commenting}
                findings={fileFindings}
                addedLines={addedLines}
                allNewSide={allNewSide}
                onFocusFindings={onFocusFindings}
              />
            ))
          )}
          {commenting && commenting.showComments && <OutdatedComments threads={outdated} />}
        </div>
      )}
    </div>
  );
}
