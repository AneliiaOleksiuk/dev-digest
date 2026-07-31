/* ReviewRunAccordion — one collapsible review RUN (a single agent's pass over
   the PR). Header shows agent + verdict + counts + score + when it ran; the
   body holds that run's VerdictBanner summary and its own FindingsPanel. A PR
   can have many runs (different agents / re-runs over time) — each is separate
   and collapsible so older runs don't bury the latest. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, type Severity } from "@devdigest/ui";
import type { ReviewRecord, Verdict } from "@devdigest/shared";
import { FindingsPanel } from "../FindingsPanel";
import { VerdictBanner } from "../VerdictBanner";
import { useDeleteReview } from "../../../../../../../lib/hooks/reviews";
import { SeverityBadgeRow, unstyledButtonStyle } from "@/components/severity-badge-button";
import { summarizeFindings } from "./helpers";

const VERDICT_COLOR: Record<string, string> = {
  request_changes: "var(--crit)",
  comment: "var(--warn)",
  approve: "var(--ok)",
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function ReviewRunAccordion({
  review,
  prId,
  defaultOpen = false,
  repoFullName,
  headSha,
  targetRunId = null,
  targetSeverity = null,
  targetFindingId = null,
  targetNonce = 0,
  onSeverityClick,
  onClearFilter,
}: {
  review: ReviewRecord;
  prId: string;
  defaultOpen?: boolean;
  repoFullName?: string | null;
  headSha?: string | null;
  /** When this matches review.run_id, the accordion opens and scrolls into view
   *  (driven from the Timeline: clicking an agent name navigates here). */
  targetRunId?: string | null;
  /** Findings severity to filter/highlight to (driven by a clicked findings
   *  counter). With no targetRunId, every run containing this severity opens
   *  (a PR-list entry point isn't scoped to one run); with a targetRunId, only
   *  that run reacts. */
  targetSeverity?: string | null;
  /** A single finding to scroll to + highlight within this run's panel. */
  targetFindingId?: string | null;
  targetNonce?: number;
  /** Clicking one of this run's own header count badges. */
  onSeverityClick?: (severity: Severity) => void;
  /** Clear an active severity/finding filter. */
  onClearFilter?: () => void;
}) {
  const t = useTranslations("prReview");
  const { run_id, findings, verdict, score, agent_name, created_at, id, summary } = review;
  const { counts: severityCounts, blockers } = summarizeFindings(findings);
  const verdictColor = verdict ? VERDICT_COLOR[verdict] ?? "var(--text-muted)" : "var(--text-muted)";

  const isTargetedRun = !!run_id && run_id === targetRunId;
  const isTargetedSeverity = !targetRunId && !!targetSeverity && findings.some((f) => f.severity === targetSeverity);
  const isFiltered = isTargetedRun || isTargetedSeverity;

  const [open, setOpen] = React.useState(defaultOpen);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (isTargetedRun || isTargetedSeverity) {
      setOpen(true);
      if (isTargetedRun) rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetRunId, targetSeverity, targetNonce, run_id]);

  const del = useDeleteReview(prId);

  return (
    <div
      ref={rootRef}
      id={run_id ? `review-run-${run_id}` : undefined}
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        background: "var(--bg-surface)",
        marginBottom: 14,
        overflow: "hidden",
        scrollMarginTop: 16,
      }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setOpen((o) => !o);
        }}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "13px 16px",
          cursor: "pointer",
          color: "var(--text-primary)",
        }}
      >
        <Icon.Cpu size={15} style={{ color: "var(--text-muted)" }} />
        <span style={{ fontWeight: 600, fontSize: 14 }}>{agent_name ?? "Agent"}</span>
        {verdict && (
          <Badge color={verdictColor} bg="transparent">
            {verdict.replace("_", " ")}
          </Badge>
        )}
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--text-muted)" }}>
          {findings.length > 0 ? (
            <SeverityBadgeRow
              counts={severityCounts}
              labelFor={(severity) => t("timeline.filterBySeverity", { severity })}
              onClick={(severity) => onSeverityClick?.(severity)}
            />
          ) : (
            "0 findings"
          )}
          {blockers > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSeverityClick?.("CRITICAL");
              }}
              style={unstyledButtonStyle}
            >
              {blockers} blocker{blockers === 1 ? "" : "s"}
            </button>
          )}
        </span>
        <span style={{ flex: 1 }} />
        {score != null && (
          <Badge mono color="var(--text-secondary)">
            {score}
          </Badge>
        )}
        <span className="mono" style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {formatWhen(created_at)}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (window.confirm(`Delete this "${agent_name ?? "agent"}" review run and its findings?`)) {
              del.mutate(id);
            }
          }}
          disabled={del.isPending}
          title="Delete this review run"
          aria-label="Delete this review run"
          style={{
            background: "none",
            border: "none",
            cursor: del.isPending ? "not-allowed" : "pointer",
            color: "var(--text-muted)",
            display: "inline-flex",
            padding: 4,
          }}
        >
          <Icon.Trash size={14} style={del.isPending ? { animation: "ddspin 1s linear infinite" } : undefined} />
        </button>
        <Icon.ChevronDown
          size={16}
          style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s", color: "var(--text-muted)" }}
        />
      </div>

      {open && (
        <div style={{ padding: "0 16px 16px" }}>
          {verdict && (
            <div style={{ marginBottom: 16 }}>
              <VerdictBanner
                verdict={verdict as Verdict}
                summary={summary}
                score={score}
                findingsCount={findings.length}
                blockers={blockers}
                agentName={agent_name}
              />
            </div>
          )}
          <FindingsPanel
            findings={findings}
            prId={prId}
            repoFullName={repoFullName}
            headSha={headSha}
            severityFilter={isFiltered ? targetSeverity : null}
            targetFindingId={isFiltered ? targetFindingId : null}
            onClearFilter={onClearFilter}
          />
        </div>
      )}
    </div>
  );
}

export default ReviewRunAccordion;
