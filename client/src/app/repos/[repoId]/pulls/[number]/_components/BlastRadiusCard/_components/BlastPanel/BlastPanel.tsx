/* BlastPanel — tree/graph/banner body for the Overview Blast Radius card.
   Owns useBlastRadius. Design parity: inline stats + Tree/Graph in one
   header row, collapsible symbol groups, file:line-only caller rows. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Skeleton, ErrorState } from "@devdigest/ui";
import type { BlastRadiusResponse } from "@devdigest/shared";
import { useBlastRadius } from "@/lib/hooks/blast";
import { computeStats } from "./helpers";
import { BlastTree } from "./BlastTree";
import { BlastGraph } from "./BlastGraph";
import { PriorPrs } from "./PriorPrs";
import { s } from "./styles";

type ViewMode = "tree" | "graph";

interface BlastPanelProps {
  prId: string | null;
  /** github.com "owner/repo" — null until the repo is loaded (no link, plain text). */
  repoFullName: string | null;
  headSha: string;
  repoId: string;
  /** Gate on PR detail sync so blast does not race empty pr_files. */
  enabled?: boolean;
}

export function BlastPanel({
  prId,
  repoFullName,
  headSha,
  repoId,
  enabled = true,
}: BlastPanelProps) {
  const { data, isLoading, isError, refetch, error, isFetching } = useBlastRadius(prId, {
    enabled,
  });
  const [view, setView] = React.useState<ViewMode>("tree");

  if (!enabled || isLoading || (isFetching && !data)) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Skeleton height={28} />
        <Skeleton height={120} />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <ErrorState
        title="Couldn't load the blast radius"
        body={error instanceof Error ? error.message : undefined}
        onRetry={() => refetch()}
      />
    );
  }

  return (
    <BlastBody
      data={data}
      view={view}
      onViewChange={setView}
      repoFullName={repoFullName}
      headSha={headSha}
      repoId={repoId}
    />
  );
}

function BlastBody({
  data,
  view,
  onViewChange,
  repoFullName,
  headSha,
  repoId,
}: {
  data: BlastRadiusResponse;
  view: ViewMode;
  onViewChange: (view: ViewMode) => void;
  repoFullName: string | null;
  headSha: string;
  repoId: string;
}) {
  const t = useTranslations("blast");
  const stats = computeStats(data);
  const groupsWithCallers = data.downstream.filter((group) => group.callers.length > 0);

  return (
    <>
      <div style={s.headerRow}>
        <div style={s.statLine} aria-label="Blast radius stats">
          <StatInline label={t("stat.symbols")} value={stats.symbols} />
          <span style={s.statDot}>·</span>
          <StatInline label={t("stat.callers")} value={stats.callers} />
          <span style={s.statDot}>·</span>
          <StatInline label={t("stat.endpoints")} value={stats.endpoints} />
          <span style={s.statDot}>·</span>
          <StatInline label={t("stat.crons")} value={stats.crons} />
        </div>
        <div style={s.viewToggle} role="group" aria-label={t("view.tree")}>
          <button
            type="button"
            onClick={() => onViewChange("tree")}
            style={{ ...s.viewBtn, ...(view === "tree" ? s.viewBtnActive : {}) }}
          >
            {t("view.tree")}
          </button>
          <button
            type="button"
            onClick={() => onViewChange("graph")}
            style={{ ...s.viewBtn, ...(view === "graph" ? s.viewBtnActive : {}) }}
          >
            {t("view.graph")}
          </button>
        </div>
      </div>

      {data.status !== "full" && (
        <div style={s.banner} role="status">
          <Icon.AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={s.bannerText}>
            <div style={s.bannerTitle}>
              {data.status === "partial" ? t("banner.partialTitle") : t("banner.degradedTitle")}
            </div>
            <div>{data.reason}</div>
          </div>
        </div>
      )}

      {groupsWithCallers.length === 0 ? (
        <div style={s.empty}>{t("noDownstream", { count: data.changed_symbols.length })}</div>
      ) : view === "tree" ? (
        <BlastTree groups={groupsWithCallers} repoFullName={repoFullName} headSha={headSha} />
      ) : (
        <BlastGraph downstream={groupsWithCallers} />
      )}

      <PriorPrs repoId={repoId} priorPrs={data.prior_prs} />
    </>
  );
}

function StatInline({ label, value }: { label: string; value: number | null }) {
  return (
    <span style={s.statInlineItem}>
      <span style={{ ...s.statInlineValue, ...(value == null ? s.statValueMuted : {}) }}>
        {value == null ? "—" : value}
      </span>{" "}
      {label}
    </span>
  );
}
