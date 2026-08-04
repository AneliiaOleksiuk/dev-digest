/* CodeLine — one rendered diff line: gutter number, +/- sign, text, plus the
   hover "+" affordance, any anchored comment threads, an inline composer, and
   (when findings cover this line) a severity marker + hover detail. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import { SeverityBadge, type Severity } from "@devdigest/ui";
import { commentTargetFor, type CommentThread, type DiffCommentApi, cs } from "../comments";
import { findingsForLine, mostSevereFinding } from "../findings";
import { type Line } from "../helpers";
import { s, lineRowFor, lineSignFor, findingRowAccent, findingTag } from "../styles";
import { CommentThreadView } from "../CommentThreadView";
import { InlineComposer } from "../InlineComposer";
import { Popover } from "@/components/popover";
import { unstyledButtonStyle } from "@/components/severity-badge-button";
import type { FocusFindingsOptions } from "@/lib/types";

const LINE_TAG_LABEL: Record<string, string> = {
  CRITICAL: "blocker",
  WARNING: "warning",
  SUGGESTION: "suggestion",
  INFO: "info",
};

export function CodeLine({
  line,
  path,
  threads,
  commenting,
  findings = [],
  onFocusFindings,
}: {
  line: Line;
  path: string;
  threads: CommentThread[];
  commenting?: DiffCommentApi;
  findings?: FindingRecord[];
  onFocusFindings?: (opts: FocusFindingsOptions) => void;
}) {
  const t = useTranslations("shell");
  const [hover, setHover] = React.useState(false);
  const [composing, setComposing] = React.useState(false);

  if (line.kind === "hunk") {
    return (
      <div className="mono" style={s.hunk}>
        {line.text}
      </div>
    );
  }

  const lineFindings = findingsForLine(findings, path, line);
  const primaryFinding = mostSevereFinding(lineFindings);

  const sign = line.kind === "add" ? "+" : line.kind === "del" ? "−" : "";
  const target = commenting?.canComment ? commentTargetFor(line) : null;
  const showAdd = hover && !!target && !composing;

  return (
    <div
      style={cs.rowWrap}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={primaryFinding ? { ...lineRowFor(line.kind), ...findingRowAccent(primaryFinding.severity) } : lineRowFor(line.kind)}>
        <span className="mono tnum" style={{ ...s.lineNo, position: "relative" }}>
          {showAdd && target && (
            <button
              type="button"
              title="Add a comment on this line"
              aria-label="Add a comment on this line"
              onClick={() => setComposing(true)}
              style={cs.addBtn}
            >
              +
            </button>
          )}
          {line.newNo ?? line.oldNo ?? ""}
        </span>
        <span className="mono" style={lineSignFor(line.kind)}>
          {sign}
        </span>
        <span className="mono" style={s.lineText}>
          {line.text || " "}
        </span>
        {primaryFinding && onFocusFindings && (
          <Popover
            panelStyle={s.findingPopoverPanel}
            trigger={
              <button
                type="button"
                aria-label={t("diffViewer.lineFindingsLabel")}
                style={{ ...unstyledButtonStyle, ...findingTag(primaryFinding.severity) }}
              >
                {LINE_TAG_LABEL[primaryFinding.severity] ?? "finding"}
              </button>
            }
          >
            <div style={s.findingPopoverList}>
              {lineFindings.map(({ id, severity, title, rationale }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onFocusFindings({ severity, findingId: id })}
                  style={s.findingPopoverRow}
                >
                  <SeverityBadge severity={severity as Severity} compact />
                  <div style={s.findingPopoverRowMain}>
                    <div style={s.findingPopoverTitle}>{title}</div>
                    <div style={s.findingPopoverRationale}>{rationale}</div>
                    <div style={s.findingPopoverJump}>{t("diffViewer.jumpToFinding")}</div>
                  </div>
                </button>
              ))}
            </div>
          </Popover>
        )}
      </div>

      {commenting &&
        commenting.showComments &&
        threads.map((thread) => (
          <CommentThreadView key={thread.rootId} thread={thread} commenting={commenting} path={path} />
        ))}

      {commenting && composing && target && (
        <InlineComposer
          commenting={commenting}
          path={path}
          line={target.line}
          side={target.side}
          onClose={() => setComposing(false)}
        />
      )}
    </div>
  );
}
