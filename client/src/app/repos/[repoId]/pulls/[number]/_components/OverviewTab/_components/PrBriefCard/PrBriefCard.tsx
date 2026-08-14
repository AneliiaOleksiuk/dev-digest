/* PrBriefCard — Overview's full-width "PR Brief" panel (SPEC-03), replaces
   PrBriefBanner. Composes: risk-level badge + what/why prose + review focus
   (clickable, deep-links into Files-changed) + risks[] + a collapsed Why
   Timeline disclosure — plus the deterministic score gauge via VerdictBanner
   (D-9/AC-32), rendered only when a completed review exists (E-21). Every
   BriefState gets a render path (WI11 DoD): the four persisted states
   (absent/current/stale/corrupt) plus the two transient generate-only
   outcomes (budget_exceeded/failed), which render IN PLACE over the existing
   good content rather than replacing it (useGeneratePrBrief never caches
   those into the main pr-brief query). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { usePrBrief, useGeneratePrBrief } from "@/lib/hooks/brief";
import { usePrReviews } from "@/lib/hooks/reviews";
import { formatCost } from "@/helpers/format";
import type { BriefRecord, BriefTimelineEntry, FocusDiffLineOptions, Risk, ReviewFocusItem } from "@/lib/types";
import { ApiError } from "@/lib/api";
import { VerdictBanner } from "../../../VerdictBanner";
import { BriefTimeline } from "./_components/BriefTimeline";
import { isFocusItemNavigable, riskLevelMeta, shortSha } from "./helpers";
import { s } from "./styles";

function CardTitle() {
  const t = useTranslations("brief");
  return (
    <div style={s.cardTitle}>
      <Icon.FileText size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
      <span style={s.cardTitleText}>{t("title")}</span>
    </div>
  );
}

function FocusList({
  items,
  changedFilePaths,
  onFocusDiffLine,
}: {
  items: ReviewFocusItem[];
  changedFilePaths: string[];
  onFocusDiffLine: (opts: FocusDiffLineOptions) => void;
}) {
  const t = useTranslations("brief");
  if (items.length === 0) return <div style={s.emptyBody}>{t("focus.empty")}</div>;
  return (
    <ul style={s.focusList}>
      {items.map((item, i) => {
        const navigable = isFocusItemNavigable(item.path, changedFilePaths);
        return (
          <li key={i}>
            <button
              type="button"
              style={{ ...s.focusItem, ...(navigable ? {} : s.focusItemDisabled) }}
              disabled={!navigable}
              title={navigable ? undefined : t("focus.unavailable")}
              onClick={() => navigable && onFocusDiffLine({ path: item.path, line: item.line })}
            >
              <span style={s.focusPathLine}>
                {item.path}:{item.line}
              </span>
              <span style={s.focusReason}>{item.reason}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function RiskList({ risks }: { risks: Risk[] }) {
  const t = useTranslations("brief");
  if (risks.length === 0) return <div style={s.emptyBody}>{t("noRisks")}</div>;
  return (
    <ul style={s.riskList}>
      {risks.map((r, i) => {
        const meta = riskLevelMeta(r.severity);
        return (
          <li key={i} style={s.riskRow}>
            <div style={s.riskTitleRow}>
              <Badge color={meta.color} bg={meta.bg}>
                {r.severity}
              </Badge>
              <span>{r.title}</span>
            </div>
            <div style={s.riskExplanation}>{r.explanation}</div>
            {r.file_refs.length > 0 && <div style={s.riskRefs}>{r.file_refs.join(", ")}</div>}
          </li>
        );
      })}
    </ul>
  );
}

function InputsDisclosure({ record }: { record: BriefRecord }) {
  const t = useTranslations("brief");
  const { input_status, usage } = record;
  const droppedCitations = usage.dropped_risk_refs + usage.dropped_focus_items;
  return (
    <details style={s.details}>
      <summary style={s.detailsSummary}>{t("inputs.title")}</summary>
      <ul style={s.inputsList}>
        <li style={s.inputsRow}>{t(`inputs.intent.${input_status.intent_status}`)}</li>
        <li style={s.inputsRow}>{t(`inputs.blast.${input_status.blast_status}`)}</li>
        <li style={s.inputsRow}>{t("inputs.changedFiles", { count: input_status.changed_file_count })}</li>
        {input_status.spec_files_used.length > 0 && (
          <li style={s.inputsRow}>{t("inputs.specFilesUsed", { count: input_status.spec_files_used.length })}</li>
        )}
        {input_status.spec_files_unresolved.length > 0 && (
          <li style={s.inputsRow}>
            {t("inputs.specFilesUnresolved", { count: input_status.spec_files_unresolved.length })}
          </li>
        )}
        <li style={s.inputsRow}>{t(`inputs.linkedIssue.${input_status.linked_issue_status}`)}</li>
        {input_status.dropped_inputs.length > 0 && (
          <li style={s.inputsRow}>{t("inputs.droppedInputs", { count: input_status.dropped_inputs.length })}</li>
        )}
        {droppedCitations > 0 && (
          <li style={s.inputsRow}>{t("inputs.droppedCitations", { count: droppedCitations })}</li>
        )}
      </ul>
    </details>
  );
}

function BriefContent({
  record,
  changedFilePaths,
  onFocusDiffLine,
}: {
  record: BriefRecord;
  changedFilePaths: string[];
  onFocusDiffLine: (opts: FocusDiffLineOptions) => void;
}) {
  const t = useTranslations("brief");
  const meta = riskLevelMeta(record.risk_level);
  return (
    <>
      <div style={s.metaRow}>
        <span style={s.riskLevelBadge(meta.color, meta.bg)}>{t(`card.riskLevel.${record.risk_level}`)}</span>
        <span style={s.describesCommit}>{t("card.describesCommit", { sha: shortSha(record.head_sha) })}</span>
      </div>

      <div>
        <div style={s.sectionHeading}>{t("card.whatTitle")}</div>
        <p style={s.prose}>{record.what}</p>
      </div>
      <div>
        <div style={s.sectionHeading}>{t("card.whyTitle")}</div>
        <p style={s.prose}>{record.why}</p>
      </div>

      <div>
        <div style={s.sectionHeading}>{t("focus.title")}</div>
        <FocusList items={record.review_focus} changedFilePaths={changedFilePaths} onFocusDiffLine={onFocusDiffLine} />
      </div>

      <div>
        <div style={s.sectionHeading}>{t("card.risksTitle")}</div>
        <RiskList risks={record.risks} />
      </div>
    </>
  );
}

export function PrBriefCard({
  prId,
  headSha,
  changedFilePaths,
  onFocusDiffLine,
}: {
  prId: string;
  headSha: string;
  changedFilePaths: string[];
  onFocusDiffLine: (opts: FocusDiffLineOptions) => void;
}) {
  const t = useTranslations("brief");
  const { data, isLoading, isError, error, refetch } = usePrBrief(prId);
  const { data: reviews } = usePrReviews(prId);
  const generate = useGeneratePrBrief(prId);
  const [historical, setHistorical] = React.useState<BriefTimelineEntry | null>(null);

  const latestReview = (reviews ?? []).find((r) => r.kind === "review" && r.verdict != null);

  const transientOutcome =
    generate.data && (generate.data.state === "budget_exceeded" || generate.data.state === "failed")
      ? generate.data
      : null;

  const doGenerate = (force: boolean) => {
    setHistorical(null);
    generate.mutate({ headSha, force });
  };

  if (isLoading && !data) {
    return (
      <section style={s.wrap}>
        <CardTitle />
        <div style={s.skeletonStack}>
          <Skeleton height={18} />
          <Skeleton height={48} />
          <Skeleton height={72} />
        </div>
      </section>
    );
  }

  if (isError && !data) {
    return (
      <section style={s.wrap}>
        <CardTitle />
        <ErrorState
          title={t("card.corruptTitle")}
          body={error instanceof ApiError ? error.message : undefined}
          onRetry={() => refetch()}
        />
      </section>
    );
  }

  const state = data?.state ?? "absent";
  const record = historical ? historical.record : (data?.record ?? null);
  const isHistorical = historical != null;

  return (
    <section style={s.wrap}>
      <CardTitle />

      {latestReview && latestReview.verdict != null && (
        <VerdictBanner
          verdict={latestReview.verdict}
          summary={latestReview.summary}
          score={latestReview.score}
          findingsCount={latestReview.findings.length}
          blockers={latestReview.findings.reduce(
            (n, f) => n + (f.severity === "CRITICAL" && !f.dismissed_at ? 1 : 0),
            0,
          )}
          agentName={latestReview.agent_name}
        />
      )}

      {transientOutcome && (
        <div style={s.banner("var(--warn)", "var(--warn-bg)")} role="status">
          <Icon.AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={s.bannerText}>
            <div style={s.bannerTitle}>
              {transientOutcome.state === "budget_exceeded" ? t("card.budgetExceededTitle") : t("card.failedTitle")}
            </div>
            <div style={s.bannerBody}>
              {transientOutcome.reason ??
                (transientOutcome.state === "budget_exceeded" ? t("card.budgetExceededBody") : t("card.failedBody"))}
            </div>
          </div>
        </div>
      )}

      {isHistorical && historical && (
        <div style={s.banner("var(--text-muted)", "var(--bg)")} role="status">
          <Icon.Clock size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={s.bannerText}>
            <div style={s.bannerBody}>{t("card.viewingHistorical", { sha: shortSha(historical.head_sha) })}</div>
          </div>
          <Button kind="secondary" size="sm" onClick={() => setHistorical(null)}>
            {t("card.backToCurrent")}
          </Button>
        </div>
      )}

      {!isHistorical && state === "stale" && record && (
        <div style={s.banner("var(--warn)", "var(--warn-bg)")} role="status">
          <Icon.AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={s.bannerText}>
            <div style={s.bannerTitle}>{t("card.staleTitle")}</div>
            <div style={s.bannerBody}>{t("card.staleBody", { sha: shortSha(record.head_sha) })}</div>
          </div>
          <Button
            kind="secondary"
            size="sm"
            icon="RefreshCw"
            loading={generate.isPending}
            disabled={generate.isPending}
            onClick={() => doGenerate(true)}
          >
            {t("generate.regenerateCta")}
          </Button>
        </div>
      )}

      {!isHistorical && state === "corrupt" && (
        <div style={s.banner("var(--crit)", "var(--crit-bg)")} role="status">
          <Icon.AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={s.bannerText}>
            <div style={s.bannerTitle}>{t("card.corruptTitle")}</div>
            <div style={s.bannerBody}>{t("card.corruptBody")}</div>
          </div>
          <Button
            kind="secondary"
            size="sm"
            icon="RefreshCw"
            loading={generate.isPending}
            disabled={generate.isPending}
            onClick={() => doGenerate(true)}
          >
            {t("generate.regenerateCta")}
          </Button>
        </div>
      )}

      {!isHistorical && state === "absent" && (
        <div style={s.empty}>
          <div style={s.emptyTitle}>{t("card.emptyTitle")}</div>
          <div style={s.emptyBody}>{t("card.emptyBody")}</div>
          <div style={s.emptyBody}>{t("generate.spendsOneGeneric")}</div>
          <Button
            kind="primary"
            size="sm"
            icon="Sparkles"
            loading={generate.isPending}
            disabled={generate.isPending}
            onClick={() => doGenerate(false)}
          >
            {t("generate.cta")}
          </Button>
        </div>
      )}

      {record && (
        <BriefContent record={record} changedFilePaths={changedFilePaths} onFocusDiffLine={onFocusDiffLine} />
      )}

      {record && !isHistorical && state === "current" && (
        <div style={s.footerRow}>
          <div style={s.metaRow}>
            <Badge color="var(--text-muted)" icon="Cpu" mono>
              {record.usage.provider}/{record.usage.model}
            </Badge>
            {record.usage.cost_usd != null && (
              <Badge color="var(--text-muted)" icon="DollarSign" mono>
                {formatCost(record.usage.cost_usd)}
              </Badge>
            )}
          </div>
          <Button
            kind="secondary"
            size="sm"
            icon="RefreshCw"
            loading={generate.isPending}
            disabled={generate.isPending}
            onClick={() => doGenerate(true)}
          >
            {t("generate.regenerateCta")}
          </Button>
        </div>
      )}

      {record && !isHistorical && <InputsDisclosure record={record} />}

      <BriefTimeline
        prId={prId}
        selectedHeadSha={historical?.head_sha ?? null}
        onSelect={(entry) => setHistorical(entry)}
        onBackToCurrent={() => setHistorical(null)}
      />
    </section>
  );
}
