"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Button, CircularScore, EmptyState, ErrorState, Skeleton, TextInput } from "@devdigest/ui";
import { AppShell } from "../../../../../../components/app-shell";
import { RepoNotFound } from "../../../../../../components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "../../../../../../lib/repo-context";
import { useContextDocuments } from "../../../../../../lib/hooks/context";
import { ApiError } from "../../../../../../lib/api";
import { DocumentPanel } from "./_components/DocumentPanel";
import { NewDocumentDialog } from "./_components/NewDocumentDialog";
import { ResyncBlockedNotice } from "./_components/ResyncBlockedNotice";
import { computeCoverage, filterDocuments, sumTokens } from "./helpers";
import { s } from "./styles";

export function ProjectContextView() {
  const t = useTranslations("context");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  const { data: listing, isLoading, isError, error, refetch } = useContextDocuments(repoId);
  const [query, setQuery] = React.useState("");
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const [panelDirty, setPanelDirty] = React.useState(false);
  const [newDocOpen, setNewDocOpen] = React.useState(false);

  // UX-13 — switching to a different document while the panel has unsaved
  // edits needs the same confirm guard as leaving Edit mode does internally.
  function selectDocument(path: string) {
    if (path === selectedPath) return;
    if (panelDirty && !window.confirm(t("edit.discardConfirm"))) return;
    setSelectedPath(path);
  }

  const repoName = activeRepo?.full_name ?? repoId ?? "";
  const crumb = [{ label: repoName, mono: true }, { label: t("crumbContext") }];

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  const documents = listing?.documents ?? [];
  // AC-7/AC-31: the header summary AND the coverage indicator both reflect
  // the currently filtered subset, from the SAME `filtered` array — one
  // filter path feeds both (UX-17), never two independently-scoped reads.
  const filtered = filterDocuments(documents, query);
  const filteredTokens = sumTokens(filtered);
  const coverage = computeCoverage(filtered);

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerTop}>
            <h1 style={s.h1}>
              {t("title")} — {repoName}
            </h1>
            {/* Visible whenever the listing loaded (incl. the E-14 zero-docs
                state, Rec-4 — creation matters most on an empty repo). */}
            {listing && !listing.degraded_reason && (
              <Button size="sm" kind="secondary" icon="Plus" onClick={() => setNewDocOpen(true)}>
                {t("newDocument.action")}
              </Button>
            )}
          </div>
          {listing && !listing.degraded_reason && (
            <div style={s.headerMeta}>
              <p style={s.summary}>{t("summary", { count: filtered.length, tokens: filteredTokens })}</p>
              {/* AC-32: a null coverage (zero eligible documents) renders nothing. */}
              {coverage && (
                <div style={s.coverage}>
                  <CircularScore score={coverage.pct} size={36} stroke={3} />
                  {/* UX-12: the number always carries its own definition, never a bare number. */}
                  <span style={s.coverageLabel}>
                    {t("coverage.label", { covered: coverage.covered, total: coverage.total })}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {newDocOpen && listing && (
          <NewDocumentDialog
            repoId={repoId}
            roots={listing.roots}
            onClose={() => setNewDocOpen(false)}
            onCreated={(path) => setSelectedPath(path)}
          />
        )}

        {/* AC-52 — a dirty clone blocking resync, read as an instruction on
            the page whose edits caused the dirtiness (D-11), not a failure. */}
        <ResyncBlockedNotice repoId={repoId} />

        {isLoading ? (
          <div style={s.loadingStack}>
            <Skeleton height={48} />
            <Skeleton height={48} />
            <Skeleton height={48} />
          </div>
        ) : isError ? (
          <ErrorState
            body={error instanceof ApiError ? error.message : t("loadError")}
            onRetry={() => refetch()}
          />
        ) : listing?.degraded_reason ? (
          // E-1 — no local clone yet.
          <EmptyState icon="Folder" title={t("empty.noClone.title")} body={listing.degraded_reason} />
        ) : documents.length === 0 ? (
          // E-14 — a clone with zero discovered .md files.
          <EmptyState icon="FileText" title={t("empty.zero.title")} body={t("empty.zero.body")} />
        ) : (
          <div style={s.layout}>
            <div style={s.listPane}>
              <TextInput value={query} onChange={setQuery} placeholder={t("searchPlaceholder")} />
              <div style={s.list}>
                {filtered.map((doc) => (
                  <button
                    key={doc.path}
                    type="button"
                    onClick={() => selectDocument(doc.path)}
                    style={{ ...s.row, ...(selectedPath === doc.path ? s.rowActive : {}) }}
                  >
                    <div style={s.rowMain}>
                      <span className="mono" style={s.rowPath}>
                        {doc.path}
                      </span>
                      {doc.missing && (
                        // E-2 — attached-but-deleted-from-disk document.
                        <Badge color="var(--warn)" icon="AlertTriangle">
                          {t("missingBadge")}
                        </Badge>
                      )}
                    </div>
                    <div style={s.rowMeta}>
                      <Badge>{doc.source_folder}</Badge>
                      <Badge mono>{doc.type}</Badge>
                      {/* UX-6/E-11: token counts are always labelled an estimate. */}
                      <span style={s.rowTokens}>{t("tokens", { tokens: doc.tokens })}</span>
                      <span style={s.rowUsage}>{t("usedByAgents", { count: doc.used_by_agents })}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div style={s.previewPane}>
              <DocumentPanel repoId={repoId} path={selectedPath} onDirtyChange={setPanelDirty} />
            </div>
          </div>
        )}

        {/* NFR A04 — outbound-data notice, present on this page too, not
            only at the attach surfaces. */}
        <p style={s.outboundNotice}>{t("outboundNotice")}</p>
      </div>
    </AppShell>
  );
}
