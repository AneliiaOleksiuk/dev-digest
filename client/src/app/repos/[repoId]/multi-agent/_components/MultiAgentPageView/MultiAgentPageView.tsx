/* MultiAgentPageView — route shell for /repos/:repoId/multi-agent (WI11-14).
   Two screens, one URL-driven state: `?pr=<prId>` (pre-selected PR, e.g. from
   the PrDetailHeader entry point) and `?run=<batchId>` (once a batch has been
   started). Both entry points (the sidebar nav item and the PR-detail header
   button) land here with the same resulting state — there is only ONE
   configure screen and ONE results screen, not two divergent flows. */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { ConfigureRunView } from "../ConfigureRunView";
import { MultiAgentResultsView } from "../MultiAgentResultsView";
import { s } from "./styles";

export function MultiAgentPageView() {
  const t = useTranslations("runs");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const router = useRouter();
  const search = useSearchParams();
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  const prId = search.get("pr");
  const runId = search.get("run");

  const setParams = (patch: Record<string, string | null>) => {
    const sp = new URLSearchParams(search.toString());
    for (const [key, val] of Object.entries(patch)) {
      if (val == null) sp.delete(key);
      else sp.set(key, val);
    }
    router.replace(`/repos/${repoId}/multi-agent${sp.toString() ? `?${sp.toString()}` : ""}`);
  };

  const repoName = activeRepo?.full_name ?? repoId;
  const crumb = [
    { label: repoName, mono: true, href: `/repos/${repoId}/pulls` },
    { label: t("page.crumb") },
  ];

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        {runId ? (
          <MultiAgentResultsView
            runId={runId}
            repoId={repoId}
            onBack={() => setParams({ run: null })}
          />
        ) : (
          <>
            <div style={s.header}>
              <h1 style={s.h1}>{t("page.title")}</h1>
              <div style={s.subtitle}>{t("page.subtitle")}</div>
            </div>
            <ConfigureRunView
              repoId={repoId}
              initialPrId={prId}
              onRunStarted={(newRunId) => setParams({ run: newRunId })}
            />
          </>
        )}
      </div>
    </AppShell>
  );
}
