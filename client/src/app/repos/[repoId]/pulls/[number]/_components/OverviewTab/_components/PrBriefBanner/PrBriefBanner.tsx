/* PrBriefBanner — Overview's full-width "PR Brief" panel (WI13, panel 1 of
   3). Only used by OverviewTab, so it nests under OverviewTab's own
   `_components/` (react-project-structure: single-consumer sub-components
   stay with their parent). Reuses VerdictBanner as-is for the classified
   case — same verdict/findings/blockers/score language already shown on the
   Findings tab — fed from the latest completed review, picked with the same
   "most-recently-created review row, kind='review'" semantics the server
   already uses for the PR-list score/cost fields (server/INSIGHTS.md
   Codebase Patterns), never an aggregate across agents/runs. Cost is only
   shown when the matching RunSummary already carries a real `cost_usd` —
   never invented; there is no "token compression" field anywhere in the
   contracts, so that mock element is intentionally omitted (see plan
   Deviations). No review yet → honest compact empty state, still occupying
   the Brief panel slot (WI13 DoD: "panel present, honest empty"). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel } from "@devdigest/ui";
import { usePrReviews, usePrRuns } from "@/lib/hooks/reviews";
import { VerdictBanner } from "../../../VerdictBanner";
import { s } from "./styles";

export function PrBriefBanner({ prId }: { prId: string }) {
  const t = useTranslations("brief");
  const { data: reviews } = usePrReviews(prId);
  const { data: prRuns } = usePrRuns(prId);

  const latest = (reviews ?? []).find((r) => r.kind === "review" && r.verdict != null);

  if (!latest || latest.verdict == null) {
    return (
      <section>
        <SectionLabel icon="FileText">{t("title")}</SectionLabel>
        <div style={s.wrap}>
          <div style={s.emptyTitle}>{t("unavailable")}</div>
          <div style={s.emptyBody}>{t("unavailableHint")}</div>
        </div>
      </section>
    );
  }

  const blockers = latest.findings.reduce(
    (n, f) => n + (f.severity === "CRITICAL" && !f.dismissed_at ? 1 : 0),
    0,
  );
  const run = (prRuns ?? []).find((r) => latest.run_id != null && r.run_id === latest.run_id);

  return (
    <section>
      <SectionLabel icon="FileText">{t("title")}</SectionLabel>
      <VerdictBanner
        verdict={latest.verdict}
        summary={latest.summary}
        score={latest.score}
        findingsCount={latest.findings.length}
        blockers={blockers}
        agentName={latest.agent_name}
        costUsd={run?.cost_usd ?? null}
      />
    </section>
  );
}
