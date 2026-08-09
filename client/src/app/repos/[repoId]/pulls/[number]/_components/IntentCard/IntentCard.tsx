/* IntentCard — derived PR intent & scope on the Overview tab.
   Product `summary` ≡ contract `intent` (see docs/plans/intent-layer.md §A.1).
   Layout follows the mock hierarchy (WI11): title INSIDE the card (icon+title
   only) → objective → in/out of scope → Risk Areas → collapsed Sources →
   truncated Missing Context → demoted confidence/model/Re-derive footer.
   Does NOT render PR Brief / Blast Radius / Description — see BlastRadiusCard
   and OverviewTab (WI13). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  ErrorState,
  Icon,
  Skeleton,
  type IconName,
} from "@devdigest/ui";
import type { IntentSource, PrIntentRecord } from "@devdigest/shared";
import { useClassifyIntent, usePrIntent } from "@/lib/hooks/reviews";
import { riskColorFor, riskIconFor, truncate } from "./helpers";
import { s } from "./styles";

const MISSING_CONTEXT_MAX_CHARS = 160;

/** In-card title — same look as SectionLabel, but no outer margin (wrap gap
 *  owns spacing). Mock puts INTENT inside the bordered card, not above it. */
function CardTitle({ icon, children }: { icon: IconName; children: React.ReactNode }) {
  const I = Icon[icon];
  return (
    <div style={s.cardTitle}>
      <I size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
      <span style={s.cardTitleText}>{children}</span>
    </div>
  );
}

export function IntentCard({ prId, headSha }: { prId: string; headSha: string }) {
  const t = useTranslations("prReview");
  const { data, isLoading, isError, refetch, error } = usePrIntent(prId);
  const classify = useClassifyIntent(prId);

  const record = data ?? null;
  const stale = record != null && record.head_sha !== headSha;
  const classifying = classify.isPending;
  const modelLabel =
    record != null
      ? record.provider && record.model
        ? `${record.provider}/${record.model}`
        : (record.model ?? record.provider ?? null)
      : null;

  return (
    <section style={s.wrap}>
      <CardTitle icon="Target">{t("intent.title")}</CardTitle>

      {(isLoading && record == null) || (classifying && record == null) ? (
        <div style={s.skeletonStack}>
          <Skeleton height={18} />
          <Skeleton height={48} />
          <Skeleton height={72} />
        </div>
      ) : isError && record == null ? (
        <ErrorState
          title={t("intent.loadError")}
          body={error instanceof Error ? error.message : undefined}
          onRetry={() => refetch()}
        />
      ) : record == null ? (
        <div style={s.empty}>
          <div style={s.emptyTitle}>{t("intent.emptyTitle")}</div>
          <div style={s.emptyBody}>{t("intent.emptyBody")}</div>
          {classify.isError && (
            <div style={s.warnBox}>
              <div style={s.warnTitle}>
                <Icon.AlertTriangle size={14} />
                {t("intent.classifyError")}
              </div>
            </div>
          )}
          <Button
            kind="primary"
            size="sm"
            icon="Sparkles"
            loading={classifying}
            disabled={classifying}
            onClick={() => classify.mutate()}
          >
            {t("intent.derive")}
          </Button>
        </div>
      ) : (
        <ClassifiedIntent
          record={record}
          stale={stale}
          classifying={classifying}
          classifyError={classify.isError}
          modelLabel={modelLabel}
          onReDerive={() => classify.mutate()}
        />
      )}
    </section>
  );
}

function ClassifiedIntent({
  record,
  stale,
  classifying,
  classifyError,
  modelLabel,
  onReDerive,
}: {
  record: PrIntentRecord;
  stale: boolean;
  classifying: boolean;
  classifyError: boolean;
  modelLabel: string | null;
  onReDerive: () => void;
}) {
  const t = useTranslations("prReview");

  return (
    <>
      {stale && (
        <div style={s.staleBanner} role="status">
          <Icon.AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={s.staleText}>
            <div style={s.staleTitle}>{t("intent.staleNotice")}</div>
            <div style={s.staleBody}>{t("intent.staleBody")}</div>
          </div>
          <Button
            kind="secondary"
            size="sm"
            icon="RefreshCw"
            loading={classifying}
            disabled={classifying}
            onClick={onReDerive}
          >
            {t("intent.reDerive")}
          </Button>
        </div>
      )}

      {classifyError && (
        <div style={s.warnBox}>
          <div style={s.warnTitle}>
            <Icon.AlertTriangle size={14} />
            {t("intent.classifyError")}
          </div>
        </div>
      )}

      {/* 1. Objective — primary prose, read first. */}
      <p style={s.intentText}>{record.intent}</p>

      {/* 2. In Scope | Out of Scope. */}
      <div style={s.scopeGrid}>
        <ScopeList
          heading={t("intent.inScope")}
          items={record.in_scope}
          empty={t("intent.noInScope")}
          variant="in"
        />
        <ScopeList
          heading={t("intent.outOfScope")}
          items={record.out_of_scope}
          empty={t("intent.noOutOfScope")}
          variant="out"
        />
      </div>

      {/* 3. Risk Areas — mock subsection label with warn icon + pill chips. */}
      {record.risk_areas.length > 0 && (
        <div style={s.riskBlock}>
          <div style={s.riskHeading}>
            <Icon.AlertTriangle size={13} style={{ color: "var(--warn)", flexShrink: 0 }} />
            {t("intent.riskAreas")}
          </div>
          <div style={s.riskPills}>
            {record.risk_areas.map((risk, i) => {
              const RiskIcon = Icon[riskIconFor(risk)];
              const color = riskColorFor(risk);
              return (
                <span key={i} style={s.riskPill}>
                  <RiskIcon size={13} style={{ color, flexShrink: 0 }} />
                  <span>{risk}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* 4. Sources — collapsed by default. */}
      {record.sources.length > 0 && (
        <details style={s.sourcesDetails}>
          <summary style={s.sourcesSummary}>
            {t("intent.sourcesToggle", { count: record.sources.length })}
          </summary>
          <ul style={s.sourceList}>
            {record.sources.map((src, i) => (
              <SourceRow key={i} source={src} />
            ))}
          </ul>
        </details>
      )}

      {/* 5. Missing context — truncated, demoted. */}
      {record.missing_context.length > 0 && (
        <div style={s.warnBox} role="status">
          <div style={s.warnTitle}>
            <Icon.AlertTriangle size={14} />
            {t("intent.missingContext")}
          </div>
          <div style={s.warnItem}>{truncate(record.missing_context[0]!, MISSING_CONTEXT_MAX_CHARS)}</div>
          {record.missing_context.length > 1 && (
            <div style={s.warnMore}>
              {t("intent.missingContextMore", { count: record.missing_context.length - 1 })}
            </div>
          )}
        </div>
      )}

      {/* 6. Meta + Re-derive — demoted footer (mock header is title-only). */}
      <div style={s.metaFooter}>
        <div style={s.metaRow}>
          {record.confidence != null && (
            <Badge color="var(--text-muted)">
              {t("intent.confidence", { pct: Math.round(record.confidence * 100) })}
            </Badge>
          )}
          {modelLabel && (
            <Badge color="var(--text-muted)" icon="Cpu" mono>
              {modelLabel}
            </Badge>
          )}
        </div>
        {!stale && (
          <Button
            kind="secondary"
            size="sm"
            icon="RefreshCw"
            loading={classifying}
            disabled={classifying}
            onClick={onReDerive}
          >
            {t("intent.reDerive")}
          </Button>
        )}
      </div>
    </>
  );
}

function ScopeList({
  heading,
  items,
  empty,
  variant,
}: {
  heading: string;
  items: string[];
  empty: string;
  variant: "in" | "out";
}) {
  const CheckOrX = variant === "in" ? Icon.Check : Icon.X;
  const iconStyle = variant === "in" ? s.scopeIconIn : s.scopeIconOut;
  return (
    <div style={s.scopeCol}>
      <div style={s.scopeHeading}>
        <CheckOrX size={12} style={iconStyle} />
        {heading}
      </div>
      {items.length === 0 ? (
        <div style={s.scopeEmpty}>{empty}</div>
      ) : (
        <ul style={s.scopeList}>
          {items.map((item, i) => (
            <li key={i} style={s.scopeItem}>
              <CheckOrX size={14} style={iconStyle} />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SourceRow({ source }: { source: IntentSource }) {
  const t = useTranslations("prReview");
  const kindLabel = t(`intent.sourceKind.${source.kind}`);
  return (
    <li style={s.sourceRow}>
      <span>{kindLabel}</span>
      {source.ref ? <span style={s.sourceRef}>{source.ref}</span> : null}
      {source.resolved ? (
        <Badge color="var(--ok)" bg="var(--ok-bg)" icon="Check">
          {t("intent.fetched")}
        </Badge>
      ) : (
        <Badge color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
          {t("intent.unavailable")}
        </Badge>
      )}
    </li>
  );
}
