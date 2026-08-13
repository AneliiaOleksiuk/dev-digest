"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { useGenerateOnboardingTour, useOnboardingTour } from "@/lib/hooks/onboarding";
import { useResyncRepoIntel } from "@/lib/hooks/repo-intel";
import { formatCost } from "@/helpers/format";
import { ApiError } from "@/lib/api";
import { SectionCard } from "./_components/SectionCard";
import { RegenerateConfirmModal } from "./_components/RegenerateConfirmModal";
import { downloadTextFile, formatAge, hasStoredTour, orderedSections, toMarkdown } from "./helpers";
import { s } from "./styles";

export function OnboardingTourView() {
  const t = useTranslations("onboarding");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  const { data: tour, isLoading, isError, error, refetch } = useOnboardingTour(repoId);
  const generateMutation = useGenerateOnboardingTour(repoId);
  const resyncMutation = useResyncRepoIntel(repoId);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const repoName = activeRepo?.full_name ?? repoId ?? "";
  const crumb = [{ label: repoName, mono: true }, { label: t("crumb") }];

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  const sectionTitle = (kind: string) => t(`sections.${kind}` as "sections.architecture");
  const sections = orderedSections(tour);
  const storedTourExists = hasStoredTour(tour);
  const age = tour ? formatAge(tour.generated_at) : null;

  function handleExport() {
    if (!tour) return;
    downloadTextFile(`${(repoName || "repo").replace(/\//g, "-")}-onboarding-tour.md`, toMarkdown(tour, repoName, sectionTitle));
  }

  function handleGenerateClick() {
    if (storedTourExists) {
      setConfirmOpen(true);
      return;
    }
    generateMutation.mutate();
  }

  function handleConfirmed() {
    setConfirmOpen(false);
    generateMutation.mutate();
  }

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerTop}>
            <h1 style={s.h1}>
              {t("title")} — {repoName}
            </h1>
            <div style={s.actions}>
              <Button kind="secondary" icon="RefreshCw" onClick={() => resyncMutation.mutate()} loading={resyncMutation.isPending}>
                {t("actions.resync")}
              </Button>
              <Button
                kind={storedTourExists ? "secondary" : "primary"}
                icon={storedTourExists ? "RefreshCw" : "Sparkles"}
                onClick={handleGenerateClick}
                loading={generateMutation.isPending}
              >
                {storedTourExists
                  ? generateMutation.isPending
                    ? t("actions.regenerating")
                    : t("actions.regenerate")
                  : generateMutation.isPending
                    ? t("actions.generating")
                    : t("actions.generate")}
              </Button>
              {tour && sections.length > 0 && (
                <Button kind="ghost" icon="ArrowDown" onClick={handleExport}>
                  {t("actions.export")}
                </Button>
              )}
            </div>
          </div>

          {tour && (
            <div style={s.metaRow}>
              <span style={s.metaText}>{age ? t("header.generated", { time: age }) : t("header.neverGenerated")}</span>
              <span style={s.metaText}>
                {t(tour.status === "partial_index" ? "header.filesIndexedPartial" : "header.filesIndexed", {
                  count: tour.files_indexed,
                })}
              </span>
              {tour.stale && <Badge color="var(--warn)" icon="AlertTriangle">{t("header.stale")}</Badge>}
            </div>
          )}

          {tour && storedTourExists && (
            <div style={s.costRow}>
              <span style={s.costText}>
                {tour.usage
                  ? `${t("cost.callCount", { count: tour.usage.call_count })} · ${t("cost.tokens", {
                      tokensIn: tour.usage.tokens_in,
                      tokensOut: tour.usage.tokens_out,
                    })} · ${t("cost.cost", { cost: formatCost(tour.usage.cost_usd) })}`
                  : t("cost.noUsage")}
              </span>
            </div>
          )}

          <p style={s.resyncNote}>{t("resyncNote")}</p>
        </div>

        {confirmOpen && (
          <RegenerateConfirmModal onConfirm={handleConfirmed} onClose={() => setConfirmOpen(false)} />
        )}

        {isLoading ? (
          <div style={s.loadingStack}>
            <Skeleton height={48} />
            <Skeleton height={120} />
            <Skeleton height={120} />
          </div>
        ) : isError ? (
          <ErrorState body={error instanceof ApiError ? error.message : t("unknownError")} onRetry={() => refetch()} />
        ) : sections.length === 0 && tour ? (
          <EmptyState
            icon="Workflow"
            title={t(emptyTitleKey(tour.status))}
            body={t(emptyBodyKey(tour.status))}
          />
        ) : (
          <div style={s.sectionList}>
            {sections.map((section, i) => (
              <SectionCard
                key={section.kind}
                section={section}
                title={sectionTitle(section.kind)}
                defaultOpen={i === 0}
                repoFullName={activeRepo?.full_name ?? null}
                defaultBranch={activeRepo?.default_branch ?? "main"}
                firstTasksBadge={section.kind === "first_tasks"}
              />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function emptyTitleKey(status: string): "empty.noClone.title" | "empty.notIndexed.title" | "empty.neverGenerated.title" | "empty.llmFailed.title" {
  if (status === "no_clone") return "empty.noClone.title";
  if (status === "not_indexed") return "empty.notIndexed.title";
  if (status === "llm_failed") return "empty.llmFailed.title";
  return "empty.neverGenerated.title";
}

function emptyBodyKey(status: string): "empty.noClone.body" | "empty.notIndexed.body" | "empty.neverGenerated.body" | "empty.llmFailed.body" {
  if (status === "no_clone") return "empty.noClone.body";
  if (status === "not_indexed") return "empty.notIndexed.body";
  if (status === "llm_failed") return "empty.llmFailed.body";
  return "empty.neverGenerated.body";
}
