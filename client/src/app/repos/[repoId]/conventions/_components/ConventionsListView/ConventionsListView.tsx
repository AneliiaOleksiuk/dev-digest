"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "../../../../../../components/app-shell";
import { RepoNotFound } from "../../../../../../components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "../../../../../../lib/repo-context";
import {
  useBulkSetConventionStatus,
  useConventions,
  useExtractConventions,
  useUpdateConvention,
} from "../../../../../../lib/hooks/conventions";
import { ApiError } from "../../../../../../lib/api";
import { ConventionCard } from "../ConventionCard";
import { CreateSkillFromConventionsModal } from "../CreateSkillFromConventionsModal";
import { s } from "./styles";

export function ConventionsListView() {
  const t = useTranslations("conventions");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  const { data: candidates, isLoading, isError, error, refetch } = useConventions(repoId);
  const extractConventions = useExtractConventions(repoId);
  const updateConvention = useUpdateConvention();
  const bulkSetStatus = useBulkSetConventionStatus();
  const [isCreateSkillModalOpen, setCreateSkillModalOpen] = React.useState(false);
  // Local selection is the source of truth for green borders / Create skill /
  // Deselect all. Server `status` is synced in the background and must not
  // drive the toolbar (post-promote refetch was clearing/locking the UI).
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(() => new Set());
  const [selectionSeededFor, setSelectionSeededFor] = React.useState<string | null>(null);
  const [mutationError, setMutationError] = React.useState<string | null>(null);

  const repoName = activeRepo?.full_name ?? t("page.repoFallback");
  const crumb = [{ label: t("page.crumbLab") }, { label: t("page.crumbConventions") }];

  // Re-seed selection only when the candidate id set changes (extract / first load),
  // not on every promote refetch — otherwise clicks feel "dead" after Create skill.
  const candidateIdsKey = candidates?.map((candidate) => candidate.id).join(",") ?? "";
  React.useEffect(() => {
    if (!candidates || candidates.length === 0) {
      setSelectedIds(new Set());
      setSelectionSeededFor(candidateIdsKey);
      return;
    }
    if (selectionSeededFor === candidateIdsKey) return;
    setSelectedIds(
      new Set(
        candidates
          .filter((candidate) => candidate.skill_id == null && candidate.status === "accepted")
          .map((candidate) => candidate.id),
      ),
    );
    setSelectionSeededFor(candidateIdsKey);
  }, [candidates, candidateIdsKey, selectionSeededFor]);

  // Drop selection for ids that no longer exist or were promoted into a skill.
  React.useEffect(() => {
    if (!candidates) return;
    setSelectedIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        const row = candidates.find((candidate) => candidate.id === id);
        if (row && row.skill_id == null) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [candidates]);

  const selectedCandidates = (candidates ?? []).filter(
    (candidate) => selectedIds.has(candidate.id) && candidate.skill_id == null,
  );
  const selectableTotal = (candidates ?? []).filter((candidate) => candidate.skill_id == null).length;

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  const onStatusError = (mutationErr: unknown) => {
    setMutationError(
      mutationErr instanceof ApiError
        ? mutationErr.message
        : "Could not update this candidate — check your connection and try again.",
    );
  };

  const persistStatus = (id: string, status: "pending" | "accepted" | "rejected") => {
    setMutationError(null);
    updateConvention.mutate(
      { id, repoId, patch: { status } },
      { onError: onStatusError },
    );
  };

  const select = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    persistStatus(id, "accepted");
  };

  const deselect = (id: string) => {
    setSelectedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    persistStatus(id, "rejected");
  };

  const unreject = (id: string) => {
    persistStatus(id, "pending");
  };

  const deselectAll = () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setMutationError(null);
    setSelectedIds(new Set());
    bulkSetStatus.mutate(
      { repoId, ids, status: "rejected" },
      { onError: onStatusError },
    );
  };

  const runExtract = () => {
    // Force re-seed after the new id set arrives.
    setSelectionSeededFor(null);
    extractConventions.mutate();
  };

  return (
    <AppShell crumb={crumb}>
      {isCreateSkillModalOpen && (
        <CreateSkillFromConventionsModal
          repoId={repoId}
          repoName={repoName}
          candidates={selectedCandidates}
          onClose={() => setCreateSkillModalOpen(false)}
          onCreated={(promotedIds) => {
            setSelectedIds((prev) => {
              const next = new Set(prev);
              for (const id of promotedIds) next.delete(id);
              return next;
            });
            setCreateSkillModalOpen(false);
          }}
        />
      )}
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>
              {t("page.headingPrefix")}
              {repoName}
            </h1>
            <p style={s.subtitle}>{t("page.subtitle")}</p>
          </div>
          <Button
            kind="secondary"
            icon="RefreshCw"
            loading={extractConventions.isPending}
            onClick={runExtract}
          >
            {extractConventions.isPending
              ? t("page.scanning")
              : candidates && candidates.length > 0
                ? t("page.rescan")
                : t("page.runExtraction")}
          </Button>
        </div>

        {extractConventions.isError && (
          <ErrorState
            title={t("page.extractionFailed")}
            body={
              extractConventions.error instanceof ApiError
                ? extractConventions.error.message
                : undefined
            }
            onRetry={runExtract}
          />
        )}

        {isLoading ? (
          <div style={s.loadingStack}>
            <Skeleton height={90} />
            <Skeleton height={90} />
            <Skeleton height={90} />
          </div>
        ) : isError ? (
          <ErrorState
            body={error instanceof ApiError ? error.message : t("page.loadError")}
            onRetry={() => refetch()}
          />
        ) : !candidates || candidates.length === 0 ? (
          <EmptyState
            icon="ListChecks"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={t("page.empty.cta")}
            onCta={runExtract}
            ctaLoading={extractConventions.isPending}
          />
        ) : (
          <>
            <p style={s.candidateCount}>
              {t("page.candidateCount", { count: candidates.length })}
            </p>
            {mutationError && <div style={s.mutationError}>{mutationError}</div>}
            <div style={s.toolbar}>
              <div style={s.toolbarLeft}>
                <Button
                  kind="secondary"
                  size="sm"
                  disabled={selectedCandidates.length === 0}
                  onClick={deselectAll}
                >
                  {t("page.deselectAll")}
                </Button>
                <span style={s.acceptedOf}>
                  {t("page.acceptedOf", {
                    accepted: selectedCandidates.length,
                    total: selectableTotal,
                  })}
                </span>
              </div>
              <Button
                kind="primary"
                size="sm"
                icon="Sparkles"
                disabled={selectedCandidates.length === 0}
                onClick={() => setCreateSkillModalOpen(true)}
              >
                {t("page.createSkill")}
              </Button>
            </div>
            <div style={s.list}>
              {candidates.map((candidate) => (
                <ConventionCard
                  key={candidate.id}
                  candidate={candidate}
                  selected={selectedIds.has(candidate.id)}
                  repoFullName={activeRepo?.full_name}
                  defaultBranch={activeRepo?.default_branch}
                  onSelect={() => select(candidate.id)}
                  onDeselect={() => deselect(candidate.id)}
                  onUndo={() => unreject(candidate.id)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
