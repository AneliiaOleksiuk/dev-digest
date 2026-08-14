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
    // FIX-6: confirmation is required before EVERY paid, outbound-data-
    // sending call — not only Regenerate. The Spec's own Non-goals ("only on
    // an explicit, confirmed user action, because it costs money") and NFR
    // A04 are not scoped to repos that already have a stored tour.
    setConfirmOpen(true);
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

          {tour && tour.status !== "ok" && (
            <div style={s.statusRow}>
              <Badge color={statusBadgeColor(tour.status)} icon={statusBadgeIcon(tour.status)}>
                {t(`status.${tour.status}` as "status.ok")}
              </Badge>
              <span style={s.statusText}>{tour.reason}</span>
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
          <RegenerateConfirmModal
            mode={storedTourExists ? "regenerate" : "generate"}
            onConfirm={handleConfirmed}
            onClose={() => setConfirmOpen(false)}
          />
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
          // Genuinely empty (e.g. a corrupted stored row, E-15) — every other
          // status still renders the 5-section skeleton server-side, so this
          // is not where per-status copy belongs (AC-16); the status/reason
          // row above already sourced tour.status/tour.reason directly.
          <EmptyState icon="Workflow" title={t("empty.generic.title")} body={tour.reason} />
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
              />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

/** Badge styling per AC-17 status — distinct enough that no_clone/not_indexed
 *  (informational) don't read as alarming as llm_failed (a real failure). */
function statusBadgeColor(status: string): string {
  if (status === "llm_failed") return "var(--crit)";
  if (status === "partial_index") return "var(--warn)";
  return "var(--text-secondary)";
}

function statusBadgeIcon(status: string): "AlertTriangle" | "Info" {
  return status === "llm_failed" || status === "partial_index" ? "AlertTriangle" : "Info";
}
